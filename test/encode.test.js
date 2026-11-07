import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, renameSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { keepNarration, readTake, takePaths, saveTake } from '../src/take.js';
import { finishTake } from '../src/encode.js';
import { emptyEdits } from '../src/edits.js';
import { tmpDir } from './tmp.js';

test('keepNarration: a take keeps its clips, and still finds them once moved', () => {
  const dir = tmpDir('narr');
  const cache = path.join(dir, 'cache');
  mkdirSync(cache);
  const clip = (name) => { const f = path.join(cache, name); writeFileSync(f, name); return f; };
  const narration = [{ file: clip('a.wav'), text: 'one', start: 0, duration: 1 }, { file: clip('b.wav'), text: 'two', start: 2, duration: 1 }];
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const base = path.join(out, 'demo-16x9');
  writeFileSync(takePaths(base).take, JSON.stringify({ narration: keepNarration(base, narration) }));
  assert.deepEqual(JSON.parse(readFileSync(takePaths(base).take, 'utf8')).narration.map((n) => n.file),
    ['demo-16x9.narration/01.wav', 'demo-16x9.narration/02.wav']);

  rmSync(cache, { recursive: true });
  renameSync(out, path.join(dir, 'moved'));
  const take = readTake(path.join(dir, 'moved', 'demo-16x9.take.json'));
  assert.deepEqual(take.narration.map((n) => readFileSync(n.file, 'utf8')), ['a.wav', 'b.wav']);

  // Re-recording with fewer lines leaves no stale clips.
  const again = path.join(dir, 'moved', 'demo-16x9');
  mkdirSync(cache);
  keepNarration(again, [{ file: clip('c.wav'), text: 'three', start: 0, duration: 1 }]);
  assert.deepEqual(readdirSync(takePaths(again).narration), ['01.wav']);
  keepNarration(again, []);
  assert.ok(!existsSync(takePaths(again).narration));
});

test('readTake: older takes with absolute clip paths still load, if the clips are in the take\'s folder', () => {
  const dir = tmpDir('narr');
  const file = path.join(dir, 'old-16x9.take.json');
  const clip = path.join(dir, '.cache', 'tts', 'x.wav');
  writeFileSync(file, JSON.stringify({ narration: [{ file: clip }] }));
  assert.equal(readTake(file).narration[0].file, clip);
  // One pointing elsewhere is refused (see untrusted-takes.test.js).
  writeFileSync(file, JSON.stringify({ narration: [{ file: '/somewhere/cache/x.wav' }] }));
  assert.throws(() => readTake(file), /outside/);
});

const noFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? false : 'no ffmpeg';

// A finished recording: a 2 s raw video and one narration clip, in a folder.
function recording() {
  const dir = tmpDir('finish');
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const raw = path.join(out, 'demo-16x9.raw.new.mkv');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', raw]);
  const clip = path.join(dir, 'say.wav');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1', clip]);
  return {
    base: path.join(out, 'demo-16x9'), raw, ok: made.status === 0,
    args: {
      scene: { name: 'demo' }, format: '16x9', scale: 1, cfg: { w: 320, h: 180, safe: null }, fps: 30, duration: 2,
      steps: [{ i: 0, action: 'say', label: 'Hi', start: 0, end: 2 }],
      narration: [{ file: clip, text: 'Hi', start: 0.2, duration: 1 }],
    },
  };
}

test('saveTake: the raw video moves into place and the take file says how it was made', () => {
  const r = recording();
  writeFileSync(r.raw, 'video');
  const file = saveTake({ base: r.base, raw: r.raw, ...r.args, extra: { remix: true } });
  assert.equal(file, takePaths(r.base).take);
  assert.equal(existsSync(r.raw), false);
  assert.equal(readFileSync(takePaths(r.base).raw, 'utf8'), 'video');
  const take = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(
    { version: take.version, scene: take.scene, format: take.format, width: take.width, height: take.height, fps: take.fps, duration: take.duration, remix: take.remix },
    { version: 1, scene: 'demo', format: '16x9', width: 320, height: 180, fps: 30, duration: 2, remix: true },
  );
  assert.ok(!Number.isNaN(Date.parse(take.recorded)));
  assert.deepEqual(take.steps.map((s) => s.action), ['say']);
  assert.deepEqual(take.narration.map((n) => n.file), ['demo-16x9.narration/01.wav']);
});

test('saveTake: a recording has no remix field unless asked', () => {
  const r = recording();
  writeFileSync(r.raw, 'video');
  assert.equal('remix' in JSON.parse(readFileSync(saveTake({ base: r.base, raw: r.raw, ...r.args }), 'utf8')), false);
});

test('finishTake: saves the take and renders the video, contact sheet and subtitles', { skip: noFfmpeg, timeout: 60000 }, async () => {
  const r = recording();
  assert.ok(r.ok, 'the test video was made');
  const res = await finishTake({ base: r.base, raw: r.raw, sceneDir: path.dirname(r.base), edits: emptyEdits(), ...r.args });
  const p = takePaths(r.base);
  for (const f of [p.take, p.raw, p.mp4, p.sheet, p.srt]) assert.ok(existsSync(f), f);
  assert.equal(res.mp4, p.mp4);
  assert.equal(res.subtitles, p.srt);
  assert.ok(Math.abs(res.duration - 2) < 0.1, `duration ${res.duration}`);
  assert.match(readFileSync(p.srt, 'utf8'), /Hi/);
});
