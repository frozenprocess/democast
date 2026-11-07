// Replay: record live, render afterwards (democast --smooth).
//
// A take is normally the stage page captured live with Chrome's
// screencast, which at 4K (or on a slow machine) delivers far fewer than
// 30 frames a second: motion stutters. In smooth mode the live run instead
// keeps a log of everything it does to the stage (each call, with its
// time) and every frame the site produced. Afterwards renderStage replays
// the log into a fresh stage page whose clock is paused, moving the clock
// forward exactly one frame at a time and capturing each frame, so the
// video has every frame however long each takes to draw.
//
// The live site and the commands are unaffected: only democast's own stage
// page runs on the paused clock, and only after the run.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, firstPage } from './browser.js';
import { noop, inside } from './util.js';
import { openEncoder } from './recorder.js';

// STAGE_URL is the file: URL of the stage page every render and recording loads.
export const STAGE_URL = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'stage.html')).href;

// readTakeLog reads a kept replay log: <dir>/log.json, with each frame's
// file made a path that resolves from anywhere.
export function readTakeLog(dir) {
  const log = JSON.parse(readFileSync(path.join(dir, 'log.json'), 'utf8'));
  log.frames = log.frames.map((f) => ({ t: f.t, file: inside(dir, f.file, `${path.join(dir, 'log.json')}: frame`) }));
  return log;
}

// Stage functions that only report something; replaying them changes
// nothing, so they aren't logged.
const QUERIES = new Set(['siteRect', 'atLineStart']);

// TakeLog collects a live run's stage calls and site frames, on the
// Date.now() clock. Site frames are written to dir as they arrive.
export class TakeLog {
  constructor(dir) {
    this.dir = dir;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    this.events = [];
    this.frames = [];
    this.writes = [];
    this.closed = false;
  }

  // call logs a stage call, with the arguments as the stage receives them
  // (already redacted).
  call(fn, args) {
    if (this.closed || QUERIES.has(fn)) return;
    this.events.push({ t: Date.now(), fn, args: JSON.parse(JSON.stringify(args)) });
  }

  // frame keeps one of the site's frames (a base64 JPEG).
  frame(data) {
    if (this.closed) return;
    const file = path.join(this.dir, `${String(this.frames.length).padStart(6, '0')}.jpg`);
    this.frames.push({ t: Date.now(), file });
    this.writes.push(writeFile(file, Buffer.from(data, 'base64')));
  }

  // close stops logging; it resolves once every frame is on disk.
  async close() {
    this.closed = true;
    await Promise.all(this.writes);
  }

  remove() {
    if (this.kept) return;
    rmSync(this.dir, { recursive: true, force: true });
  }

  // keep moves the log (frames, plus the calls and timing in log.json) to
  // dir, so the take can be rendered again later; remove() then leaves it.
  keep(dir, meta) {
    rmSync(dir, { recursive: true, force: true });
    renameSync(this.dir, dir);
    const rel = (f) => path.basename(f);
    writeFileSync(path.join(dir, 'log.json'), JSON.stringify({
      ...meta, events: this.events, frames: this.frames.map((f) => ({ t: f.t, file: rel(f.file) })),
    }));
    this.dir = dir;
    this.kept = true;
  }
}

// timeline merges a log's calls and frames into one list in time order,
// calls first when they share a time. Site frames that a later one replaces
// before the next call or the next video frame are dropped (they'd never
// be seen). frameTimes are the video frames' times, ascending.
export function timeline(events, frames, frameTimes) {
  const items = [
    ...events.map((e) => ({ t: e.t, call: e })),
    ...frames.map((f) => ({ t: f.t, frame: f })),
  ].sort((a, b) => a.t - b.t || (a.call ? -1 : 0) - (b.call ? -1 : 0));
  // The video frame each item is shown in: the first at or after it.
  let k = 0;
  const shownIn = items.map((it) => {
    while (k < frameTimes.length && frameTimes[k] < it.t) k++;
    return k;
  });
  return items.filter((it, i) => {
    if (!it.frame) return true;
    const next = items[i + 1];
    return !(next && next.frame && shownIn[i + 1] === shownIn[i]);
  });
}

// installClock runs in the stage page. Its tick(now) pauses every
// animation (CSS transitions and keyframes) and sets each to where it
// should be at now (ms on the replay clock), so animations follow the
// replay clock exactly instead of the compositor's. tick reports whether
// the page may look different than at the last tick, so unchanged frames
// needn't be captured again.
function installClock() {
  // While the clock is paused, a page with every animation paused and no
  // timers left produces no frames, and a screenshot waits for one
  // forever. One invisible animation that keeps running avoids that.
  const beat = document.createElement('div');
  Object.assign(beat.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', pointerEvents: 'none' });
  document.body.append(beat);
  const heartbeat = beat.animate([{ opacity: 0 }, { opacity: 0.01 }], { duration: 1000, iterations: Infinity });
  let changed = true;
  new MutationObserver(() => { changed = true; }).observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });
  window.__democastClock = {
    tick(now) {
      let dirty = changed;
      changed = false;
      for (const a of document.getAnimations()) {
        if (a === heartbeat) continue;
        if (a.__start === undefined) {
          a.__start = now;
          a.pause();
          dirty = true;
        }
        const t = Math.max(0, now - /** @type {number} */ (a.__start));
        const end = /** @type {number} */ (a.effect?.getComputedTiming().endTime ?? Infinity);
        if (Number.isFinite(end)) {
          if (!a.__done) dirty = true;
          a.__done = t >= end;
          a.currentTime = Math.min(t, end);
        } else {
          // Endless ones (the caret's blink) change in steps; check four
          // times a second rather than capturing every frame.
          const step = Math.floor(t / 250);
          if (step !== a.__step) dirty = true;
          a.__step = step;
          a.currentTime = t;
        }
      }
      return dirty;
    },
  };
}

// A ReplayClock moves the stage page's virtual time. now is the replay
// clock on the Date.now() timeline; origin is where it started.
class ReplayClock {
  constructor(page, session, origin) {
    this.page = page;
    this.session = session;
    this.origin = origin;
    this.now = origin;
  }

  // advanceTo lets the page run until t.
  async advanceTo(t) {
    const budget = t - this.now;
    if (budget <= 0) return;
    const expired = once(this.session, 'Emulation.virtualTimeBudgetExpired');
    await this.session.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget });
    await expired;
    this.now = t;
  }

  // tick sets the page's animations to the clock, and tells whether the
  // page may look different (see installClock).
  tick() {
    return this.page.evaluate((now) => window.__democastClock.tick(now), this.now - this.origin);
  }
}

// openStage loads the stage page, with its clock installed and virtual
// time paused, and returns { page, session }.
async function openStage(browser, stageUrl, source) {
  const page = await firstPage(browser);
  await page.bringToFront();
  await page.goto(stageUrl);
  // The log's own stage.init call sets the layout; it reads this.
  if (source) await page.evaluate((src) => { window.__democastSource = src; }, source);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(installClock);
  const session = await page.createCDPSession();
  await session.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  return { page, session };
}

// applyItem plays one item of the timeline into the page, at its time,
// and tells whether the page may look different afterwards.
async function applyItem(page, clock, it) {
  await clock.advanceTo(it.t);
  if (it.call) {
    // Don't wait for the call: one that sleeps (typing, moving the
    // pointer) finishes as the clock moves on.
    await page.evaluate((fn, args) => {
      try {
        const r = window.stage[fn](...args);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch {}
    }, it.call.fn, it.call.args);
    // Start the call's animations at its time, not the next frame's.
    return clock.tick();
  }
  const b64 = (await readFile(it.frame.file)).toString('base64');
  await page.evaluate((d) => window.stage.siteFrame(d), b64);
  return true;
}

// renderStage replays log into the stage page at stageUrl, at cfg's size
// times scale, and writes duration seconds from t0 (ms, Date.now() clock)
// to file at fps. It returns the number of frames written.
// source ("browser", "term" or "term2") renders that window alone, full
// frame, instead of the stage's layout (see --sources).
export async function renderStage({ chrome, stageUrl, cfg, scale, log, t0, duration, fps, file, source = null, progress = noop }) {
  const width = Math.round(cfg.w * scale);
  const height = Math.round(cfg.h * scale);
  const n = Math.round(duration * fps);
  const frameTimes = Array.from({ length: n }, (_, k) => t0 + (k * 1000) / fps);
  const items = timeline(log.events, log.frames, frameTimes);

  const browser = await launch({ chrome, width: cfg.w, height: cfg.h, dsf: scale });
  const enc = openEncoder({ file, fps, width, height });
  try {
    const { page, session } = await openStage(browser, stageUrl, source);
    const clock = new ReplayClock(page, session, Math.min(t0, items[0]?.t ?? t0));

    let i = 0;
    let dirty = true;
    let shot = null;
    let captured = 0;
    let lastReport = 0;
    for (let k = 0; k < n; k++) {
      for (; i < items.length && items[i].t <= frameTimes[k]; i++) {
        if (await applyItem(page, clock, items[i])) dirty = true;
      }
      await clock.advanceTo(frameTimes[k]);
      if (await clock.tick()) dirty = true;
      if (dirty || !shot) {
        const { data } = await session.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
        shot = Buffer.from(data, 'base64');
        captured++;
        dirty = false;
      }
      if (!enc.stdin.write(shot)) await once(enc.stdin, 'drain');
      const pct = Math.floor(((k + 1) / n) * 10) * 10;
      if (pct > lastReport && pct < 100) {
        lastReport = pct;
        progress(`rendering ${pct}%`);
      }
    }
    enc.stdin.end();
    await enc.done;
    progress(`rendered ${n} frames (${captured} drawn, the rest unchanged)`);
    return n;
  } catch (err) {
    enc.proc.kill('SIGKILL');
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}
