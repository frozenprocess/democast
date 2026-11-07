// Remix: a new video cut from takes already recorded, without recording
// anything. A remix scene (remix: true) lists clips, time ranges of one
// window of a kept take (--sources or --sources-later keeps <take>.log/),
// between the usual cards, captions and narration. It can be in any
// format: the console's frames are cropped to a zoom box, and terminal
// text is laid out again for the new window, so a 16x9 pass becomes a 9x16
// short.
//
// The remix is built as a replay log, the same calls and site frames a
// smooth take logs live, on a timeline made up here; renderStage draws it
// and renderTake adds the narration, subtitles and edits, as for any take.

import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { actionOf } from './scene.js';
import { stageConfig, TITLE_BAR as BAR } from './formats.js';
import { CARD_FADE, VOICE_GAP, CARD_LEAD, TAIL } from './timing.js';
import { renderStage, readTakeLog, STAGE_URL } from './replay.js';
import { shortLabel, noop } from './util.js';
import { finishTake } from './encode.js';
import { outputBase, resolveFps } from './take.js';
import { terminalOps } from './termhtml.js';
import { sayText } from './tts.js';
import { tempPath, release } from './cleanup.js';


const WINDOWS = ['browser', 'term', 'term2'];

// loadTakeLog reads a kept take log: a <take>.log/ directory, or the
// take's base name (out/a-16x9) or its MP4.
export function loadTakeLog(ref, baseDir) {
  let dir = path.resolve(baseDir, ref).replace(/\/$/, '').replace(/\.mp4$/, '');
  if (!dir.endsWith('.log')) dir += '.log';
  const file = path.join(dir, 'log.json');
  if (!existsSync(file)) throw new Error(`${ref}: no ${path.relative('.', file)} (record the take with --sources or --sources-later)`);
  const log = readTakeLog(dir);
  log.dir = dir;
  return log;
}

// checkClip checks a clip step's settings before anything is built.
function checkClip(c, i) {
  const where = `step ${i} (clip)`;
  if (!c || typeof c !== 'object') throw new Error(`${where}: want a mapping with take, window, from and to`);
  if (!c.take) throw new Error(`${where}: needs "take"`);
  if (!WINDOWS.includes(c.window ?? 'browser')) throw new Error(`${where}: window: want ${WINDOWS.join(', ')}`);
  if (!(c.from >= 0) || !(c.to > c.from)) throw new Error(`${where}: want 0 <= from < to (seconds into the take)`);
  if (c.speed != null && !(c.speed > 0)) throw new Error(`${where}: speed must be above 0`);
  if (c.zoom != null) {
    const z = c.zoom;
    if (!(z.w > 0 && z.w <= 1) || !((z.x ?? 0) >= 0) || !((z.y ?? 0) >= 0)) {
      throw new Error(`${where}: zoom: want x, y (0–1, the box's top left) and w (0–1, its width), as fractions of the page`);
    }
  }
}

// siteRectAt is where the site was on the take's stage at time t (ms on
// the log's clock), following its view: steps; null if hidden.
function siteRectAt(log, t) {
  let view = null;
  for (const e of log.events) {
    if (e.t > t) break;
    if (e.fn === 'view') view = e.args[0];
  }
  const r = view ? log.cfg.views?.[view]?.browser : log.cfg.browser;
  return r ? { x: r.x, y: r.y + BAR, w: r.w, h: r.h - BAR } : null;
}

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

// inlineImage reads a card's image file as a data: URL, so the stage page
// can show it from anywhere.
function inlineImage(file) {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

// The builder method for each of REMIX_ACTIONS (test/remix.test.js checks
// they agree).
export const METHOD_OF = {
  wait: 'wait', caption: 'caption', card: 'card', hideCard: 'hideCard', 'cursor.hide': 'hideCursor', say: 'say', clip: 'clip',
};

// A RemixBuilder lays a remix scene out on a made-up clock T (ms): each
// action adds stage events and site frames at T, or later for a clip, and
// moves T on.
export class RemixBuilder {
  constructor({ scene, sceneDir, format, clips }) {
    this.scene = scene;
    this.sceneDir = sceneDir;
    this.clips = clips;
    this.logs = new Map();
    const windows = new Set(scene.steps.filter((s) => 'clip' in s).map((s) => s.clip.window ?? 'browser'));
    const panels = { browser: windows.has('browser'), term: windows.has('term') || windows.has('term2') };
    if (!panels.browser && !panels.term) throw new Error('a remix needs at least one clip');
    this.cfg = stageConfig(format, scene, panels);
    if (scene.terminal?.title) this.cfg.termTitle = scene.terminal.title;

    this.t0 = 1e12; // any fixed epoch: the timeline is made up
    this.T = this.t0;
    this.events = [{ t: this.t0 - 1000, fn: 'init', args: [this.cfg] }];
    this.frames = [];
    this.timeline = [];
    this.narration = [];
    this.voiceFreeAt = this.t0;
    this.cardShownAt = this.t0;
    this.shown = null; // the window last shown: "browser" or "term"

    const b = this.cfg.browser;
    this.W = b?.w;
    this.H = b ? b.h - BAR : 0;
    this.site = b ? { x: b.x, y: b.y + BAR, w: this.W, h: this.H } : null;
  }

  // logOf loads a take's replay log, once; ref is a name from the scene's
  // takes: or a path.
  logOf(ref) {
    const p = (this.scene.takes ?? {})[ref] ?? ref;
    if (!this.logs.has(p)) this.logs.set(p, loadTakeLog(p, this.sceneDir));
    return this.logs.get(p);
  }

  call(fn, ...args) { this.events.push({ t: Math.round(this.T), fn, args }); }
  callAt(t, fn, ...args) { this.events.push({ t: Math.round(t), fn, args }); }

  wait(ms) { this.T += Number(ms); }

  caption(c) {
    if (c == null || typeof c === 'string') c = { text: c ?? '' };
    this.call('caption', c.text, c.sub);
  }

  card(c) {
    c = { ...c };
    if (c.image && !/^[a-z]+:/.test(c.image)) c.image = inlineImage(path.resolve(this.sceneDir, c.image));
    this.call('card', c);
    this.cardShownAt = this.T;
  }

  hideCard(arg) {
    this.T = Math.max(this.T, this.cardShownAt + (arg?.minShown ?? 0));
    this.call('hideCard');
    this.T += CARD_FADE;
  }

  hideCursor() { this.call('hideCursor'); }

  say(arg, step) {
    const clip = this.clips?.get(step);
    if (!clip) return;
    this.T = Math.max(this.T, this.voiceFreeAt);
    this.narration.push({ file: clip.file, text: sayText(arg), start: (this.T - this.t0) / 1000, duration: clip.duration });
    this.voiceFreeAt = this.T + clip.duration * 1000 + VOICE_GAP;
    if (arg.wait !== false) this.T = this.voiceFreeAt;
  }

  clip(c) {
    const log = this.logOf(c.take);
    const win = c.window ?? 'browser';
    const from = log.t0 + c.from * 1000, to = log.t0 + c.to * 1000, speed = c.speed ?? 1;
    if (c.from > log.duration) throw new Error(`clip ${c.take}: from ${c.from}s is past the take's end (${log.duration.toFixed(1)}s)`);
    const start = this.T;
    const at = (t) => start + (t - from) / speed;
    if (win === 'browser') this.clipBrowser(log, c, from, to, at);
    else this.clipTerm(log, c, win, from, to, at);
    this.T = start + (to - from) / speed;
  }

  clipBrowser(log, c, from, to, at) {
    const { W, H, site } = /** @type {{ W: number, H: number, site: import('./types.js').Rect }} */ (this);
    const r = siteRectAt(log, from);
    if (!r) throw new Error(`clip ${c.take}: the console isn't on screen at ${c.from}s (view: term)`);
    // The zoom box, in fractions of the page; its height follows from the
    // window's shape, and it stays on the page.
    const z = c.zoom ?? { x: 0, y: 0, w: 1 };
    const aspect = r.h / r.w; // the page's height / width in this take
    const w = z.w;
    const h = (w * H / W) / aspect;
    const x = Math.min(z.x ?? 0, 1 - w);
    const y = h < 1 ? Math.min(z.y ?? 0, 1 - h) : 0;
    const box = { x, y, w, h };
    this.call('focus', 'browser');
    // From a terminal, or with pan: false, the box changes at once.
    this.call('siteBox', box, this.shown !== 'browser' || c.pan === false);
    this.call('hideCursor');
    this.shown = 'browser';
    // Where the page is when the clip starts: the latest frame and URL.
    const before = log.frames.filter((f) => f.t <= from);
    if (before.length) this.frames.push({ t: this.T, file: before.at(-1).file });
    for (const f of log.frames) if (f.t > from && f.t <= to) this.frames.push({ t: at(f.t), file: f.file });
    const url = log.events.filter((e) => e.fn === 'setUrl' && e.t <= from).at(-1);
    if (url) this.call('setUrl', url.args[0]);
    // The pointer, from the take's stage to this window through the box.
    for (const e of log.events) {
      if (e.t <= from || e.t > to) continue;
      if (e.fn === 'setUrl') this.callAt(at(e.t), 'setUrl', e.args[0]);
      else if (e.fn === 'clickFx' && c.pointer !== false) this.callAt(at(e.t), 'clickFx');
      else if (e.fn === 'moveTo' && c.pointer !== false) {
        const sr = siteRectAt(log, e.t);
        if (!sr) continue;
        const u = ((e.args[0] - sr.x) / sr.w - box.x) / box.w;
        const v = ((e.args[1] - sr.y) / sr.h - box.y) / box.h;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) this.callAt(at(e.t), 'moveTo', site.x + u * site.w, site.y + v * site.h);
        else this.callAt(at(e.t), 'hideCursor');
      }
    }
  }

  clipTerm(log, c, pane, from, to, at) {
    const ops = (log.ops ??= terminalOps(log))[pane];
    if (!log.cfg[pane]) throw new Error(`clip ${c.take}: the take has no ${pane}`);
    const rel = (ms) => log.t0 + ms; // terminalOps times are from the take's start
    this.call('focus', 'term');
    this.call('hideCursor');
    this.shown = 'term';
    this.call('termTitle', c.title ?? log.cfg[pane === 'term2' ? 'term2Title' : 'termTitle'] ?? '~ — bash', 'term');
    // The screen as it was when the clip starts, at once; then what comes.
    this.call('termReset', 'term');
    let text = [];
    const flush = () => { for (const [x, cls] of text) this.call('print', x, cls, 'term'); text = []; };
    for (const o of ops) {
      const t = rel(o.t);
      if (o.k === 'clear') {
        if (t <= from) { text = []; } else if (t <= to) { flush(); this.callAt(at(t), 'termReset', 'term'); }
      } else if (o.k === 'print') {
        if (t <= from) text.push([o.x, o.c]);
        else if (t <= to) { flush(); this.callAt(at(t), 'print', o.x, o.c, 'term'); }
      } else {
        const chars = [...o.x];
        let typed = '';
        chars.forEach((ch, i) => {
          const tc = t + o.d[i];
          if (tc <= from) typed += ch;
          else if (tc <= to) { if (typed) { text.push([typed, '']); typed = ''; } flush(); this.callAt(at(tc), 'print', ch, '', 'term'); }
        });
        if (typed) text.push([typed, '']);
      }
    }
    flush();
  }

  // run plays the scene's steps, filling the timeline.
  run() {
    const { t0 } = this;
    for (const [i, step] of this.scene.steps.entries()) {
      const action = actionOf(step);
      const arg = step[action];
      // A leading card is up before the video starts, as in a recording.
      if (i === 0 && action === 'card') {
        this.T = t0 - CARD_LEAD;
        this.card(arg);
        this.T = t0;
        this.cardShownAt = t0;
        this.timeline.push({ i, action, label: label(arg), start: 0, end: 0 });
        continue;
      }
      const entry = { i, action, label: label(action === 'clip' ? `${arg.take} ${arg.window ?? 'browser'} ${arg.from}–${arg.to}s` : arg), start: (this.T - t0) / 1000 };
      this[METHOD_OF[action]](arg, step);
      entry.end = (this.T - t0) / 1000;
      this.timeline.push(entry);
    }
    this.T = Math.max(this.T, this.voiceFreeAt) + TAIL;
    this.events.sort((a, b) => a.t - b.t);
    this.frames.sort((a, b) => a.t - b.t);
  }
}

// buildRemix lays a remix scene out as a replay log: { cfg, events,
// frames, t0, duration, timeline, narration }. clips maps say steps to
// their narration (see prepareNarration).
export function buildRemix({ scene, sceneDir, format, clips }) {
  scene.steps.forEach((s, i) => { if ('clip' in s) checkClip(s.clip, i); });
  const b = new RemixBuilder({ scene, sceneDir, format, clips });
  b.run();
  return { cfg: b.cfg, events: b.events, frames: b.frames, t0: b.t0, duration: (b.T - b.t0) / 1000, timeline: b.timeline, narration: b.narration };
}

function label(arg) {
  const v = arg && typeof arg === 'object' ? arg.text ?? arg.title ?? '' : arg ?? '';
  return shortLabel(v);
}

// remix renders a remix scene in one format, like record does a scene,
// and returns what renderTake returns.
export async function remix({ scene, sceneDir, format, outDir, chrome, clips, edits, scale = 1, fps = resolveFps(scene), log = noop }) {
  mkdirSync(outDir, { recursive: true });
  const base = outputBase(outDir, scene, format, scale);
  const raw = tempPath(base + '.raw.new.mkv');
  const r = buildRemix({ scene, sceneDir, format, clips });
  log(`  ${r.timeline.filter((s) => s.action === 'clip').length} clips, ${r.duration.toFixed(1)}s`);
  try {
    await renderStage({
      chrome, stageUrl: STAGE_URL, cfg: r.cfg, scale, log: r,
      t0: r.t0, duration: r.duration, fps, file: raw, progress: (m) => log(`  ${m}`),
    });
    return await finishTake({
      base, raw, scene, sceneDir, edits, format, scale, cfg: r.cfg, fps, duration: r.duration,
      steps: r.timeline, narration: r.narration, extra: { remix: true },
    });
  } finally {
    rmSync(raw, { force: true });
    release(raw);
  }
}
