// The context of a run: the state every step shares (the stage, the site,
// captured variables, narration and the timeline) and how a step is run.
// Actions (actions/) run with this set to the Context.

import { redactRules, redactText, redactStageArgs } from './redact.js';
import { interp } from './vars.js';
import { stopProc } from './procs.js';
import { ACTIONS } from './actions/index.js';
import { actionOf, paneOf, panelOf } from './scene.js';
import { shortLabel } from './util.js';
import { Site } from './site.js';

export class Context {
  // takeLog (smooth mode) records the stage's calls and the site's frames
  // for the later render. siteDsf(panelW) is the device pixel ratio the
  // site's browser runs at, for a panel panelW wide.
  /**
   * @param {{ scene: import('./types.js').Scene, sceneDir: string, cfg: import('./types.js').StageConfig, clips?: Map<any, any>,
   *   log: import('./types.js').Logger, takeLog?: import('./replay.js').TakeLog | null, siteDsf: (panelW: number) => number }} options
   */
  constructor({ scene, sceneDir, cfg, clips, log, takeLog = null, siteDsf }) {
    this.takeLog = takeLog;
    this.siteSink = takeLog ? (data) => takeLog.frame(data) : undefined;
    this.siteDsf = siteDsf;
    // Set by record() as the browsers start: the stage's page, and the
    // site (site.js) shown on it.
    this.page = null;
    this.site = new Site(this);
    // When the recording started (Date.now()), set before the first step.
    this.t0 = 0;
    // The per-window videos, when the scene was rendered with sources.
    this.sourceFiles = null;
    this.scene = scene;
    this.clips = clips;
    this.narration = [];
    this.timeline = [];
    // A background command that fails rejects this, which stops the scene
    // at whatever step is running, instead of at a later timeout.
    this.bgFailure = new Promise((_, reject) => { this.failBackground = reject; });
    this.bgFailure.catch(() => {});
    this.voiceFreeAt = 0;
    this.sceneDir = sceneDir;
    this.cfg = cfg;
    this.log = log;
    this.vars = { env: process.env };
    this.redact = redactRules(scene.redact, (s) => this.interp(s));
    this.procs = new Map();
    this.cardShownAt = 0;
    this.timeout = scene.timeout ?? 60000;
  }

  // stage calls a function of the stage page. Text it draws (terminal,
  // URL bar, captions, cards) is redacted on the way.
  stage(fn, ...args) {
    args = redactStageArgs(this.redact, fn, args);
    this.takeLog?.call(fn, args);
    return this.page.evaluate((fn, args) => window.stage[fn](...args), fn, args);
  }

  // useStage sets the page that draws the stage.
  useStage(page) {
    this.page = page;
  }

  // start marks when the recording began (Date.now()).
  start(t0) {
    this.t0 = t0;
  }

  setSourceFiles(files) {
    this.sourceFiles = files;
  }

  // shown is a value as it may be printed in democast's own output, which
  // can end up in a CI log: redacted like the video.
  shown(v) {
    return redactText(this.redact, String(v));
  }

  // teardown runs the scene's teardown steps, once, after the take's last
  // step or its failure, e.g. to delete what the scene created before the
  // next format or retry. A failing step is reported and the rest still
  // run: tearing down shouldn't cost a good take.
  async teardown() {
    if (this.tornDown || !this.scene.teardown?.length) return;
    this.tornDown = true;
    for (const [i, step] of this.scene.teardown.entries()) {
      try {
        await this.run(step, i, { offCamera: 'teardown' });
      } catch (err) {
        this.log(`  warning: ${err.message}`);
      }
    }
  }

  // run runs one step. Setup and teardown steps (offCamera: their name)
  // aren't in the take's timeline.
  /**
   * @param {import('./types.js').Step} step
   * @param {number} i
   * @param {{ offCamera?: 'setup' | 'teardown' | null }} [options]
   */
  async run(step, i, { offCamera = null } = {}) {
    const action = actionOf(step);
    const handler = ACTIONS[action];
    if (!handler) throw new Error(`step ${i}: unknown action ${JSON.stringify(action)}`);
    const where = offCamera ? `${offCamera} step ${i}` : `step ${i}`;
    this.log(`  ${where}: ${action}`);
    // In focus layouts, show the panel a step uses before running it.
    if (this.scene.autoFocus !== false) {
      const panelName = panelOf(action);
      const panel = panelName === 'term' ? paneOf(step[action]) : panelName;
      if (panel) await this.stage('focus', panel);
    }
    // A timeout inside the action's mapping counts too: it's an easy place
    // to put it.
    const arg = step[action];
    const timeout = step.timeout ?? (arg && typeof arg === 'object' ? arg.timeout : undefined) ?? this.timeout;
    const now = () => (this.t0 ? Math.max(0, (Date.now() - this.t0) / 1000) : 0);
    const entry = { i, action, label: this.shown(stepLabel(action, step[action])), start: now() };
    if (!offCamera) this.timeline.push(entry);
    try {
      // A failed background command stops the scene; teardown runs anyway.
      const stop = offCamera === 'teardown' ? [] : [this.bgFailure];
      await Promise.race([handler.call(this, step[action], { timeout }, step), ...stop]);
      entry.end = now();
    } catch (err) {
      err.message = `${where} (${action}): ${err.message}`;
      throw err;
    }
  }

  // interp replaces {{name}} with captured variables (vars.js).
  interp(v) {
    return interp(v, this.vars);
  }

  killAll() {
    for (const p of this.procs.values()) stopProc(p.proc);
  }
}

// stepLabel is a short description of a step for the editor's timeline.
function stepLabel(action, arg) {
  const v = arg && typeof arg === 'object' && !Array.isArray(arg)
    ? arg.text ?? arg.title ?? arg.show ?? arg.selector ?? arg.url ?? arg.regex ?? arg.key ?? arg.var ?? (typeof arg.cmd === 'string' ? arg.cmd : null)
    : arg;
  return shortLabel(v);
}
