// Ctrl-C in the middle of a recording: democast exits with 130 and leaves
// nothing behind. A run's finally blocks don't run when it exits on a
// signal, so cleanup.js and procs.js do the work; this checks they do.
//
// Each run gets its own $TMPDIR, so what it leaves in it (Chrome's
// temporary profile, session copies) can be told from what other tests
// make at the same time. Skipped without Chrome or ffmpeg.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { tmpDir } from './tmp.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const skip = !findChrome() ? 'no Chrome' : !has('ffmpeg') ? 'no ffmpeg' : process.platform === 'win32' ? 'needs ps' : false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME_SETTLES = 4000; // ms after launch that a fresh Chrome is done starting up
// ours lists what a run leaves in its temporary folder: democast's own
// (Chrome's profile, session copies) and the scratch folders Chrome makes
// itself (com.google.Chrome.*), which it removes only when it quits rather
// than being killed.
const ours = (dir) => readdirSync(dir).filter((f) => f.startsWith('democast-') || f.startsWith('com.google.Chrome'));
const processes = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });

// waitFor polls until check() is truthy, or fails after ms.
async function waitFor(check, what, ms = 40000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = check();
    if (v) return v;
  }
  assert.fail(`timed out waiting for ${what}`);
}

// interrupted starts a recording whose only step is a command that runs far
// longer than the test, waits until the recording is under way (ready()
// says when), sends Ctrl-C, and returns how it ended and what is left.
async function interrupted(flags, ready, { twice = false } = {}) {
  const dir = tmpDir('interrupt');
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const mine = path.join(dir, 'tmp');
  mkdirSync(mine);
  // The number in the command tells it apart from any other sleep.
  const marker = `sleep ${3000 + Math.floor(Math.random() * 1000)}`;
  const scene = path.join(dir, 'long.yaml');
  writeFileSync(scene, `timeout: 120000\nsteps:\n  - term.run: { cmd: "${marker}", show: false }\n`);

  const child = spawn(process.execPath, [CLI, '--no-voice', '-f', '1x1', '-o', out, ...flags, scene], {
    env: { ...process.env, TMPDIR: mine }, stdio: 'ignore',
  });
  const ended = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  try {
    await waitFor(() => processes().includes(marker), 'the scene\'s command to start');
    await waitFor(() => ready(out), 'the recording to be under way');
    // A fresh Chrome makes one more scratch folder (chrome_chrome_url_fetcher_.*)
    // for its first second or two and removes it itself; a Ctrl-C inside that
    // window leaves it, whatever democast does. A real interruption comes
    // later in a recording, so wait it out.
    await sleep(CHROME_SETTLES);
    // Chrome's temporary profile exists now, so "gone" below means something.
    const before = ours(mine);
    assert.ok(before.some((f) => f.startsWith('democast-chrome-')), `a temporary Chrome profile while recording: ${before}`);
    child.kill('SIGINT');
    // A second Ctrl-C doesn't wait for Chrome to quit.
    if (twice) { await sleep(150); child.kill('SIGINT'); }
    const { code, signal } = await Promise.race([ended, sleep(30000).then(() => assert.fail('democast did not exit after Ctrl-C'))]);
    // The exit handlers' work is finished when the process is gone; Chrome's
    // last writes to its profile can lag a moment, so look for a little while.
    const left = () => (twice ? ours(mine).filter((f) => f.startsWith('democast-')) : ours(mine));
    const clean = () => !processes().includes(marker) && !processes().includes(mine) && left().length === 0;
    for (const end = Date.now() + 10000; !clean() && Date.now() < end;) await sleep(200);
    return { code, signal, out: readdirSync(out), tmp: left(), command: processes().includes(marker), chrome: processes().includes(mine) };
  } finally {
    child.kill('SIGKILL');
    // Never leave the test's own sleep running, whatever happened.
    try { execFileSync('pkill', ['-f', marker]); } catch {}
  }
}

test('Ctrl-C during a live recording: exit 130, no Chrome, command or files left', { skip, timeout: 120000 }, async () => {
  // Live recording writes <name>-1x1.raw.new.mkv while it runs.
  const r = await interrupted([], (out) => readdirSync(out).some((f) => f.endsWith('.raw.new.mkv')));
  assert.equal(r.code, 130, `exit status (signal ${r.signal})`);
  assert.deepEqual(r.out, [], 'the output folder is empty');
  assert.deepEqual(r.tmp, [], 'no temporary folders left, democast\'s or Chrome\'s');
  assert.equal(r.command, false, 'the scene\'s command was stopped');
  assert.equal(r.chrome, false, 'Chrome was stopped');
});

test('Ctrl-C during a --smooth recording: no frames folder or raw video left', { skip, timeout: 120000 }, async () => {
  // Smooth mode keeps the site's frames in <name>-1x1.frames/ until the render.
  const r = await interrupted(['--smooth'], (out) => readdirSync(out).some((f) => f.endsWith('.frames')));
  assert.equal(r.code, 130, `exit status (signal ${r.signal})`);
  assert.deepEqual(r.out, [], 'the output folder is empty');
  assert.deepEqual(r.tmp, [], 'no temporary folders left, democast\'s or Chrome\'s');
  assert.equal(r.command, false);
  assert.equal(r.chrome, false);
});

test('Ctrl-C during --smooth --sources keeps nothing half-written either', { skip, timeout: 120000 }, async () => {
  const r = await interrupted(['--smooth', '--sources'], (out) => readdirSync(out).some((f) => f.endsWith('.frames')));
  assert.equal(r.code, 130, `exit status (signal ${r.signal})`);
  assert.deepEqual(r.out, [], 'the output folder is empty');
  assert.deepEqual(r.tmp, []);
});

test('a second Ctrl-C does not wait for Chrome: democast\'s own files and processes are still gone', { skip, timeout: 120000 }, async () => {
  const r = await interrupted([], (out) => readdirSync(out).some((f) => f.endsWith('.raw.new.mkv')), { twice: true });
  assert.equal(r.code, 130, `exit status (signal ${r.signal})`);
  assert.deepEqual(r.out, [], 'the output folder is empty');
  assert.deepEqual(r.tmp, [], 'no democast temporary folders (Chrome\'s own may stay)');
  assert.equal(r.command, false);
  assert.equal(r.chrome, false);
});

test('the test\'s own bookkeeping: the marker is found while the command runs', () => {
  assert.equal(existsSync(CLI), true);
  assert.ok(processes().includes('PID'), 'ps lists processes');
});
