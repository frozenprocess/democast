// Runner: plays a scene's steps against a stage page in headless Chrome
// (a live website in a fake browser window, and a terminal panel running
// real commands), records it, and encodes an MP4.

import { mkdirSync, rmSync } from 'node:fs';
import { stageConfig, TITLE_BAR } from './formats.js';
import { CARD_LEAD, TAIL } from './timing.js';
import { startRecording } from './recorder.js';
import { finishTake } from './encode.js';
import { outputBase, resolveFps } from './take.js';
import { TakeLog, renderStage, STAGE_URL } from './replay.js';
import { renderSources } from './sources.js';
import { launch, firstPage, setupSitePage, profileName, snapshotProfile, openProfile, removeProfileCopy } from './browser.js';
import { tempPath, release } from './cleanup.js';
import { sleep, noop } from './util.js';
import { panelsFor } from './scene.js';
import { Context } from './context.js';
import { Resources } from './resources.js';

// Pauses and limits (ms) around the start and end of a recording.
const SETTLE_AFTER_VIEW = 1500; // a leading view: the site lays itself out
const FIRST_FRAME_TIMEOUT = 15000; // wait for the site's first frame
const FIRST_FRAME_POLL = 100;

// record renders one format of a scene to <outDir>/<name>-<format>.mp4.
// clips maps say steps to their synthesized narration (see prepareNarration);
// without it, say steps are skipped.
// scale multiplies the output resolution (2 renders 16x9 at 3840x2160)
// without changing the layout: the page is rendered at that device pixel
// ratio, so text and the site stay sharp.
// The take (raw recording and timings) is kept next to the MP4, so edits
// can be re-rendered without recording again.
// smooth records live but renders the video afterwards, frame by frame
// (see replay.js): every frame is there, at any scale, however slow the
// machine; it takes longer.
// sources (needs smooth) also renders each window on its own, full frame
// (<base>-browser.mp4, -terminal.mp4, -terminal2.mp4; see sources.js), a
// few at a time, and keeps the log. sourcesLater keeps the log and the
// sharp site capture but renders no sources: `democast sources` does,
// later. jobs is how many source renders run at once.
export async function record({ scene, sceneDir, format, outDir, chrome, headed, clips, edits, scale = 1, fps = resolveFps(scene), guides = false, smooth = false, sources = false, sourcesLater = false, jobs, log = noop }) {
  if ((sources || sourcesLater) && !smooth) throw new Error('sources needs smooth');
  const keepLog = sources || sourcesLater;
  mkdirSync(outDir, { recursive: true });
  const base = outputBase(outDir, scene, format, scale, guides ? '-guides' : '');
  const raw = tempPath(base + '.raw.new.mkv');
  const cfg = stageConfig(format, scene, panelsFor(scene), { guides });

  // In smooth mode the live stage is only there to pace the run, so it
  // needn't be drawn at full resolution; the video is rendered from the log.
  const framesDir = smooth ? tempPath(base + '.frames') : null;
  const takeLog = smooth ? new TakeLog(framesDir) : null;
  // With sources, the site is captured sharp enough to fill the frame on
  // its own: as many device pixels as the whole frame is wide.
  const siteDsf = (panelW) => (cfg.browser?.scale ?? 1) * scale * (keepLog ? Math.max(1, cfg.w / panelW) : 1);
  const ctx = new Context({ scene, sceneDir, cfg, clips, log, takeLog, siteDsf });
  // What the finally block must release, registered as it is created and
  // released in the opposite order: temporary files, which the run needs
  // until its end, and the browsers and commands, which smooth mode lets go
  // of before it renders.
  const files = new Resources();
  const res = new Resources();
  files.add(() => {
    rmSync(raw, { force: true });
    release(raw);
    takeLog?.remove();
    if (framesDir) release(framesDir);
  });
  let recorder = null;
  try {
    await launchStage(ctx, res, { chrome, headed, cfg, scale, smooth });
    if (cfg.browser) await launchSite(ctx, res, { chrome, headed, scene, cfg });
    res.add(() => ctx.killAll());

    // Setup steps run before recording starts and aren't in the video,
    // e.g. to sign in with a form or get the site into a starting state.
    for (const [i, step] of (scene.setup ?? []).entries()) await ctx.run(step, i, { offCamera: 'setup' });

    const steps = [...scene.steps];
    const first = await runLeadingSteps(ctx, steps);
    await waitForFirstFrame(ctx, log);

    let duration;
    if (takeLog) {
      ctx.start(Date.now());
      await runSteps(ctx, steps, first);
      // As the live recorder does, let the last change show for a moment.
      await sleep(TAIL);
      const t1 = Date.now();
      await ctx.teardown();
      await takeLog.close();
      // Nothing live is needed to render; free the machine for it.
      await res.closeAll();
      const frames = await renderStage({
        chrome, stageUrl: STAGE_URL, cfg, scale, log: takeLog,
        t0: ctx.t0, duration: (t1 - ctx.t0) / 1000, fps, file: raw, progress: (m) => log(`  ${m}`),
      });
      duration = frames / fps;
      if (keepLog) {
        takeLog.keep(base + '.log', { scene: scene.name, format, scale, fps, t0: ctx.t0, duration: (t1 - ctx.t0) / 1000, cfg });
        if (sources) ctx.setSourceFiles(await renderSources([base + '.log'], { chrome, jobs, force: true, log }));
      }
    } else {
      recorder = await startRecording(ctx.page, { file: raw, fps, width: cfg.w * scale, height: cfg.h * scale });
      res.add(() => recorder?.abort());
      ctx.start(recorder.t0);
      await runSteps(ctx, steps, first);
      duration = await recorder.stop();
      recorder = null;
      await ctx.teardown();
    }
    for (const st of ctx.timeline) st.end ??= duration;

    const result = await finishTake({
      base, raw, scene, sceneDir, edits, format, scale, cfg, fps, duration, steps: ctx.timeline, narration: ctx.narration,
    });
    return ctx.sourceFiles ? { ...result, sources: ctx.sourceFiles } : result;
  } catch (err) {
    // In smooth mode the live stage doesn't show the site; screenshot the
    // site itself.
    const failing = takeLog ? ctx.site.page ?? ctx.page : ctx.page;
    if (failing && !failing.isClosed()) {
      await failing.screenshot({ path: base + '-error.png' }).catch(() => {});
      err.message += `\n  (screenshot of the failing moment: ${base}-error.png)`;
    }
    await ctx.teardown();
    throw err;
  } finally {
    await res.closeAll();
    await files.closeAll();
  }
}

// launchStage starts the browser that draws the stage and loads stage.html.
async function launchStage(ctx, res, { chrome, headed, cfg, scale, smooth }) {
  const browser = await launch({ chrome, headed, width: cfg.w, height: cfg.h, dsf: smooth ? 1 : scale });
  res.add(() => browser.close().catch(() => {}));
  const page = await firstPage(browser);
  ctx.useStage(page);
  // Headless Chrome sometimes starts a page hidden, and a hidden page
  // doesn't paint, so there would be nothing to record.
  await page.bringToFront();
  await page.goto(STAGE_URL);
  await ctx.stage('init', cfg);
}

// launchSite starts the site's own browser, sized to the panel at the
// scene's zoom, from a fresh copy of the scene's saved login, if any, and
// mirrors it onto the stage.
async function launchSite(ctx, res, { chrome, headed, scene, cfg }) {
  const profile = profileName(scene);
  // saveSession runs on the saved profile itself; otherwise on a copy.
  const inPlace = !!(profile && scene.browser?.saveSession);
  let userDataDir;
  if (profile) {
    userDataDir = inPlace ? openProfile(profile) : snapshotProfile(profile);
    // Released after the browser that uses it is closed.
    res.add(() => { if (!inPlace) removeProfileCopy(userDataDir); });
  }
  const zoom = cfg.browser.scale;
  const browser = await launch({
    chrome, headed, userDataDir, site: true,
    width: Math.round(cfg.browser.w / zoom),
    height: Math.round((cfg.browser.h - TITLE_BAR) / zoom),
    dsf: ctx.siteDsf(cfg.browser.w),
  });
  res.add(() => browser.close().catch(() => {}));
  res.add(() => ctx.site.stop());
  const sitePage = await firstPage(browser);
  ctx.site.use(sitePage);
  await sitePage.bringToFront();
  const b = scene.browser ?? {};
  await setupSitePage(sitePage, {
    auth: b.auth && ctx.interp(b.auth),
    headers: b.headers && ctx.interp(b.headers),
    blur: b.blur && [].concat(b.blur),
    redact: ctx.redact,
    site: scene.site && ctx.interp(scene.site),
  });
  // The fake URL bar follows the site, unless the scene fixes a label.
  sitePage.on('framenavigated', (f) => {
    if (f === sitePage.mainFrame() && !ctx.site.urlLabel) ctx.stage('setUrl', f.url()).catch(() => {});
  });
  await ctx.site.show(sitePage);
  if (scene.site) await ctx.site.open(scene.site, scene.siteLabel);
}

// runLeadingSteps runs, before recording starts, a leading card (so the
// video doesn't open on an empty stage) and a leading view (so it opens on
// that view, without the switch). It removes them from steps and returns
// how many it ran, which is the index of the next step.
async function runLeadingSteps(ctx, steps) {
  let first = 0;
  if (steps.length && Object.keys(steps[0])[0] === 'card') {
    await ctx.run(steps.shift(), 0);
    first = 1;
    await sleep(CARD_LEAD);
  }
  if (steps.length && Object.keys(steps[0])[0] === 'view') {
    await ctx.run(steps.shift(), first);
    first += 1;
    await sleep(SETTLE_AFTER_VIEW);
  }
  return first;
}

// waitForFirstFrame keeps the video from starting on an empty browser panel.
async function waitForFirstFrame(ctx, log) {
  const warn = () => log(`  warning: no frames from the site after ${FIRST_FRAME_TIMEOUT / 1000}s`);
  if (ctx.site.mirror && ctx.takeLog) {
    for (const end = Date.now() + FIRST_FRAME_TIMEOUT; !ctx.takeLog.frames.length && Date.now() < end;) await sleep(FIRST_FRAME_POLL);
    if (!ctx.takeLog.frames.length) warn();
  } else if (ctx.site.mirror) {
    await ctx.page.waitForFunction(() => window.stage.siteFrames > 0, { timeout: FIRST_FRAME_TIMEOUT }).catch(warn);
  }
}

// runSteps runs the scene's steps in order; first is the index of steps[0]
// in the scene, after any leading steps run before recording.
async function runSteps(ctx, steps, first) {
  for (const [i, step] of steps.entries()) await ctx.run(step, i + first);
}
