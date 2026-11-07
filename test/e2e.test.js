import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { tmpDir } from './tmp.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const missing = !findChrome() ? 'no Chrome' : !has('ffmpeg') || !has('ffprobe') ? 'no ffmpeg' : false;

test('records a terminal-only scene into an MP4 of the expected length', { skip: missing, timeout: 120000 }, () => {
  const dir = tmpDir('e2e');
  const scene = path.join(dir, 'term.yaml');
  writeFileSync(scene, 'steps:\n  - term.run: "echo hello"\n  - wait: 1500\n');
  const out = path.join(dir, 'out');
  execFileSync(process.execPath, [CLI, '--no-voice', '-f', '16x9', '-o', out, scene], { stdio: 'pipe' });
  const mp4 = path.join(out, 'term-16x9.mp4');
  assert.ok(existsSync(mp4));
  assert.ok(existsSync(path.join(out, 'term-16x9-sheet.png')));
  const probe = (entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim();
  // Typing "echo hello" plus the wait: about 2.5s.
  const duration = Number(probe('format=duration'));
  assert.ok(duration > 1.8 && duration < 6, `duration ${duration}`);
  assert.equal(probe('stream=width,height'), '1920,1080');
});

test('a timeout inside an action\'s mapping applies to the step', { skip: missing, timeout: 120000 }, () => {
  const dir = tmpDir('e2e');
  const scene = path.join(dir, 'slow.yaml');
  writeFileSync(scene, 'steps:\n  - term.run: { cmd: "sleep 20", show: false, timeout: 500 }\n');
  const r = spawnSync(process.execPath, [CLI, '--no-voice', '-f', '16x9', '-o', path.join(dir, 'out'), scene], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /timed out after 500ms/);
});

test('teardown runs after a failed take, and its own failures are only warnings', { skip: missing, timeout: 120000 }, () => {
  const dir = tmpDir('e2e');
  const scene = path.join(dir, 'td.yaml');
  writeFileSync(scene, 'steps:\n  - term.run: "false"\nteardown:\n  - term.run: "exit 3"\n  - term.run: "touch cleaned"\n');
  const r = spawnSync(process.execPath, [CLI, '--no-voice', '-f', '16x9', '-o', path.join(dir, 'out'), scene], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /warning: teardown step 0 \(term\.run\): exit 3: exit status 3/);
  assert.ok(existsSync(path.join(dir, 'cleaned')));
});

test('a scene-level env fills in {{env.NAME}}', { skip: missing, timeout: 120000 }, () => {
  const dir = tmpDir('e2e');
  const scene = path.join(dir, 'env.yaml');
  writeFileSync(scene, 'env: { GREETING: "hi {{env.DEMOCAST_TEST_NAME}}" }\nsteps:\n  - term.run: { cmd: \'test "$GREETING" = "hi there"\', show: false }\n');
  const r = spawnSync(process.execPath, [CLI, '--no-voice', '-f', '16x9', '-o', path.join(dir, 'out'), scene], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, DEMOCAST_TEST_NAME: 'there' },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
