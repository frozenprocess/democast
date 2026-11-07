// The command line, run as a subprocess: exit codes and messages of each
// command, for the cases that need neither Chrome nor a recording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { tmpDir } from './tmp.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const noFfmpeg = has('ffmpeg') ? false : 'no ffmpeg';
const noChrome = noFfmpeg || (findChrome() ? false : 'no Chrome');

const democast = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000 });
const scene = (dir, yaml, name = 's.yaml') => {
  const file = path.join(dir, name);
  writeFileSync(file, yaml);
  return file;
};

test('--help prints the usage and exits 0', () => {
  const r = democast('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^usage:/);
  assert.match(r.stdout, /democast sources/);
});

test('no scene prints the usage and exits 2', () => {
  const r = democast();
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^usage:/);
  assert.equal(democast('render').status, 2);
});

test('--jobs must be a whole number above 0', () => {
  const r = democast('--jobs', '0', '--help');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: --jobs must be a whole number above 0, got 0/);
});

test('sources: no arguments is a usage error; --help is not', () => {
  assert.equal(democast('sources').status, 2);
  assert.equal(democast('sources', '--help').status, 0);
});

test('sources: a missing path, and a folder without logs', () => {
  const dir = tmpDir('cli');
  const missing = democast('sources', path.join(dir, 'nope'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /democast: .*nope: not a directory/);
  const empty = democast('sources', dir);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /democast: no replay logs found/);
});

test('an unreadable or invalid scene is reported with the democast: prefix', () => {
  const dir = tmpDir('cli');
  const none = democast('check', path.join(dir, 'missing.yaml'));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^democast: reading /);
  const bad = democast('check', scene(dir, 'steps: []\n'));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^democast: scene needs a non-empty "steps" list/);
});

test('an unknown format is reported before anything runs', () => {
  const dir = tmpDir('cli');
  const r = democast('-f', 'bogus', 'check', scene(dir, 'steps:\n  - caption: hi\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: unknown format bogus; want one of 16x9/);
});

test('check: a ready scene prints its summary and ok', () => {
  const dir = tmpDir('cli');
  const out = path.join(dir, 'out');
  const r = democast('-o', out, 'check', scene(dir, 'steps:\n  - caption: hi\n'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /takes: 0 in /);
  assert.match(r.stdout, /edits: 0 region\(s\)/);
  assert.match(r.stdout, /\nok\n$/);
});

test('check: problems go to stderr and the exit status is 1', () => {
  const dir = tmpDir('cli');
  const r = democast('check', scene(dir, 'music: nothere.mp3\nsteps:\n  - caption: hi\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /problem: music: no file nothere\.mp3/);
  assert.match(r.stdout, /1 problem\(s\)/);
});

test('check: counts the takes recorded for the scene', () => {
  const dir = tmpDir('cli');
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const file = scene(dir, 'steps:\n  - caption: hi\n');
  writeFileSync(path.join(out, 's-16x9.take.json'), JSON.stringify({
    version: 1, scene: 's', format: '16x9', scale: 1, fps: 30, duration: 1, steps: [{ i: 0, action: 'caption', start: 0, end: 1 }], narration: [],
  }));
  const r = democast('-o', out, 'check', file);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /takes: 1 in /);
});

test('render: nothing recorded yet is an error', { skip: noFfmpeg }, () => {
  const dir = tmpDir('cli');
  const r = democast('-o', path.join(dir, 'out'), 'render', scene(dir, 'steps:\n  - caption: hi\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: no recorded takes of s in /);
});

test('login: a scene without a site has nothing to sign in to', { skip: noFfmpeg }, () => {
  const dir = tmpDir('cli');
  const r = democast('login', scene(dir, 'steps:\n  - caption: hi\n'));
  // Without Chrome it stops there first; either way it's a plain error.
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: (no Chrome found|the scene has no "site")/);
});

test('record: --voice-only with no narration prints nothing and exits 0', { skip: noFfmpeg }, () => {
  const dir = tmpDir('cli');
  const r = democast('--voice-only', scene(dir, 'steps:\n  - caption: hi\n'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('record: bad --scale and --fps are rejected before recording', { skip: noChrome }, () => {
  const dir = tmpDir('cli');
  const file = scene(dir, 'steps:\n  - caption: hi\n');
  const scale = democast('--no-voice', '--scale', '9', file);
  assert.equal(scale.status, 1);
  assert.match(scale.stderr, /^democast: --scale must be a number between 0 and 4, got 9/);
  const fps = democast('--no-voice', '--fps', '0', file);
  assert.equal(fps.status, 1);
  assert.match(fps.stderr, /^democast: --fps must be a whole number from 1 to 120, got 0/);
});

test('a bad "formats" in the scene is rejected when it loads', () => {
  const dir = tmpDir('cli');
  const r = democast('check', scene(dir, 'formats: [bogus]\nsteps:\n  - caption: hi\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: formats\[0\]: want one of/);
});

test('sources: logs to render need ffmpeg, reported before any Chrome is started', () => {
  const dir = tmpDir('cli');
  const log = path.join(dir, 'a-16x9.log');
  mkdirSync(log);
  writeFileSync(path.join(log, 'log.json'), JSON.stringify({ cfg: { term: {} }, frames: [], events: [] }));
  const r = spawnSync(process.execPath, [CLI, 'sources', dir], { encoding: 'utf8', env: { ...process.env, PATH: '' }, timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: ffmpeg not found in PATH/);
});
