import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { sourceJobs } from '../src/sources.js';
import { tmpDir } from './tmp.js';

function take(cfg) {
  const dir = tmpDir('src');
  const logDir = path.join(dir, 'scene-16x9.log');
  mkdirSync(logDir);
  writeFileSync(path.join(logDir, 'log.json'), JSON.stringify({ cfg, events: [], frames: [] }));
  return { dir, logDir };
}

test('sourceJobs: one job per window the take has', () => {
  const { logDir } = take({ browser: {}, term: {}, term2: null });
  assert.deepEqual(sourceJobs(logDir).map((j) => j.name), ['browser', 'terminal']);
  assert.ok(sourceJobs(logDir)[0].mp4.endsWith('scene-16x9-browser.mp4'));
});

test('sourceJobs: skips a source newer than its log, unless forced', () => {
  const { dir, logDir } = take({ browser: {}, term: {} });
  const old = new Date(Date.now() - 60_000);
  utimesSync(path.join(logDir, 'log.json'), old, old);
  writeFileSync(path.join(dir, 'scene-16x9-browser.mp4'), '');
  assert.deepEqual(sourceJobs(logDir).map((j) => j.name), ['terminal']);
  assert.deepEqual(sourceJobs(logDir, { force: true }).map((j) => j.name), ['browser', 'terminal']);
});

test('sourceJobs: a folder without log.json is an error', () => {
  assert.throws(() => sourceJobs(tmpDir('src')), /no log.json/);
});
