// Terminal actions: commands typed and really run, their output shown.
// Each runs with this set to the run's Context (runner.js).

import { paneOf } from '../scene.js';
import { spawn } from 'node:child_process';
import { lineBuffer } from '../redact.js';
import { running, stopProc } from '../procs.js';
import { sleep } from '../util.js';


// typeTemplate types the literal parts of a template and "pastes" the
// {{variable}} parts instantly, the way a person would paste a long token.
// Pauses (ms) that make typing look human.
const PAUSE_BEFORE_PASTE = 250;
const PAUSE_AFTER_PASTE = 350;
const PAUSE_BEFORE_ENTER = 300;
const OUTPUT_FLUSH_DELAY = 50; // let the last output arrive before flushing

async function typeTemplate(ctx, tmpl, cps, pane = 'term') {
  const parts = tmpl.split(/(\{\{\s*[\w.]+\s*\}\})/);
  for (const part of parts) {
    if (!part) continue;
    if (/^\{\{/.test(part)) {
      await sleep(PAUSE_BEFORE_PASTE);
      await ctx.stage('print', ctx.interp(part), undefined, pane);
      await sleep(PAUSE_AFTER_PASTE);
    } else {
      await ctx.stage('type', part, cps, pane);
    }
  }
}

// ensurePromptLine starts a new line in the pane unless it's at the start of one.
async function ensurePromptLine(ctx, pane) {
  if (!(await ctx.stage('atLineStart', pane))) await ctx.stage('print', '\n', undefined, pane);
}

function asCommand(cmd) {
  if (Array.isArray(cmd)) return { file: cmd[0], args: cmd.slice(1), text: cmd.join(' ') };
  return { file: 'sh', args: ['-c', cmd], text: cmd };
}


export const TERM_ACTIONS = {
  async 'term.type'(arg) {
    const a = typeof arg === 'string' ? { text: arg } : arg;
    await typeTemplate(this, a.text, a.cps ?? this.scene.terminal?.cps ?? 28, paneOf(a));
  },
  async 'term.print'(arg) {
    const a = typeof arg === 'string' ? { text: arg } : arg;
    await this.stage('print', this.interp(a.text), a.style ?? 'out', paneOf(a));
  },
  async 'term.clear'(arg) { await this.stage('clear', paneOf(arg)); },

  async 'term.run'(arg, { timeout }) {
    const a = typeof arg === 'string' ? { cmd: arg } : { ...arg };
    const cmd = asCommand(this.interp(a.cmd));
    const show = a.show ?? (Array.isArray(a.cmd) ? a.cmd.join(' ') : a.cmd);
    const id = a.id ?? `proc${this.procs.size}`;
    const print = a.print ?? 'both';
    const pane = paneOf(a);

    if (show !== false) {
      await typeTemplate(this, show, a.cps ?? this.scene.terminal?.cps ?? 28, pane);
      await sleep(PAUSE_BEFORE_ENTER);
    }
    await this.stage('print', '\n', undefined, pane);

    const proc = spawn(cmd.file, cmd.args, {
      cwd: this.sceneDir,
      env: { ...process.env, ...this.interp(this.scene.env ?? {}), ...this.interp(a.env ?? {}) },
      stdio: [a.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    running.add(proc);
    proc.on('exit', () => running.delete(proc));
    if (a.stdin != null) proc.stdin?.end(this.interp(a.stdin));

    let captureResolve, captureReject;
    const captured = new Promise((res, rej) => { captureResolve = res; captureReject = rej; });
    const cap = a.capture && { ...a.capture, re: new RegExp(a.capture.regex), buf: '' };
    const output = { stdout: '', stderr: '', all: '' };
    const printAs = (cls) => (text) => this.stage('print', text, cls, pane).catch(() => {});
    // With redaction, output is printed a line at a time, so a match split
    // across chunks is still caught.
    const sinks = this.redact.length
      ? { stdout: lineBuffer(this.redact, printAs('out')), stderr: lineBuffer(this.redact, printAs('err')) }
      : { stdout: { write: printAs('out'), flush() {} }, stderr: { write: printAs('err'), flush() {} } };
    const watchers = new Set();
    const onData = (stream) => (chunk) => {
      output[stream] += chunk;
      output.all += chunk;
      for (const w of watchers) w();
      if (print === 'both' || print === stream) sinks[stream].write(chunk);
      if (cap && !cap.done && (!cap.from || cap.from === stream)) {
        cap.buf += chunk;
        const m = cap.buf.match(cap.re);
        if (m) {
          cap.done = true;
          this.vars[cap.var] = m[1] ?? m[0];
          this.log(`    ${cap.var} = ${this.shown(this.vars[cap.var])}`);
          captureResolve();
        }
      }
    };
    proc.stdout?.setEncoding('utf8').on('data', onData('stdout'));
    proc.stderr?.setEncoding('utf8').on('data', onData('stderr'));

    const done = new Promise((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', async (code, signal) => {
        if (cap && !cap.done) captureReject(new Error(`${cmd.text}: exited before printing a match for ${a.capture.regex}`));
        await sleep(OUTPUT_FLUSH_DELAY);
        sinks.stdout.flush();
        sinks.stderr.flush();
        await ensurePromptLine(this, pane).catch(() => {});
        await this.stage('prompt', pane).catch(() => {});
        if (code !== 0 && !a.allowFail && !signal) {
          const err = new Error(`${cmd.text}: exit status ${code}\n${output.stderr.slice(-2000)}`);
          if (a.background) {
            this.failBackground(new Error(`background command ${JSON.stringify(id)} failed: ${err.message}`));
          }
          reject(err);
        } else {
          resolve({ code, output });
        }
      });
    });
    done.catch(() => {}); // background failures are reported via bgFailure
    this.procs.set(id, { proc, done, output, watchers });

    const withTimeout = (p, what) => Promise.race([
      p,
      sleep(timeout).then(() => { throw new Error(`${cmd.text}: timed out after ${timeout}ms ${what}`); }),
    ]);
    if (a.background) {
      if (cap) await withTimeout(captured, 'waiting for capture');
    } else {
      await withTimeout(done, 'waiting to exit');
      if (cap) await captured;
    }
  },
  async 'term.wait'(id, { timeout }) {
    const p = this.procs.get(id);
    if (!p) throw new Error(`no process with id ${JSON.stringify(id)}`);
    await Promise.race([
      p.done,
      sleep(timeout).then(() => { throw new Error(`timed out after ${timeout}ms waiting for ${id}`); }),
    ]);
  },
  // term.waitFor waits until a background command prints something
  // matching regex, counting only output from this step on. With var, the
  // match (group 1 if any) is saved.
  async 'term.waitFor'(arg, { timeout }) {
    const a = this.interp(arg);
    const p = this.procs.get(a.id);
    if (!p) throw new Error(`no process with id ${JSON.stringify(a.id)}`);
    const re = new RegExp(a.regex);
    const from = p.output.all.length;
    let check;
    try {
      const m = await new Promise((resolve, reject) => {
        check = () => {
          const m = p.output.all.slice(from).match(re);
          if (m) resolve(m);
        };
        p.watchers.add(check);
        check();
        p.done.then(() => reject(new Error(`${a.id} exited before printing a match for ${a.regex}`)), reject);
        sleep(timeout).then(() => reject(new Error(`timed out after ${timeout}ms waiting for ${a.id} to print a match for ${a.regex}`)));
      });
      if (a.var) {
        this.vars[a.var] = m[1] ?? m[0];
        this.log(`    ${a.var} = ${this.shown(this.vars[a.var])}`);
      }
    } finally {
      p.watchers.delete(check);
    }
  },
  async 'term.kill'(id) {
    const p = this.procs.get(id);
    if (!p) throw new Error(`no process with id ${JSON.stringify(id)}`);
    stopProc(p.proc);
    await p.done.catch(() => {});
  },
};
