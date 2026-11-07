import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArgs } from '../src/filters.js';
import { resolveEdits, segments } from '../src/edits.js';

// The ffmpeg command for a take, in its five shapes. The snapshots
// (render.test.js.snapshot) change whenever the filter graph does: check
// the diff, then update them with npm run test:update.
const take = {
  base: '/out/demo-16x9', format: '16x9', scale: 1, width: 1920, height: 1080,
  safe: { top: 40, bottom: 40, left: 40, right: 40 }, duration: 10,
  steps: [
    { i: 0, action: 'say', start: 0, end: 2 },
    { i: 1, action: 'term.run', start: 2, end: 10 },
  ],
  narration: [
    { file: '/out/demo-16x9.narration/01.wav', text: 'Hello', start: 0.5, duration: 1.5 },
    { file: '/out/demo-16x9.narration/02.wav', text: 'Then this', start: 4, duration: 2 },
  ],
};
const at = (step, offset) => ({ step, action: take.steps[step].action, offset });
const edits = {
  audio: { voice: 0.9, music: 0.5 },
  trim: { start: at(0, 0.25) },
  regions: [
    { type: 'cut', from: at(1, 1), to: at(1, 1.5) },
    { type: 'speed', factor: 3, from: at(1, 4), to: at(1, 7) },
  ],
};
const textEdits = { ...edits, regions: [...edits.regions, { type: 'text', text: 'Fast: 3x', position: 'top', from: at(1, 3), to: at(1, 5) }] };

function argsFor(t, scene, e) {
  const res = resolveEdits(t, e);
  return renderArgs({ take: t, scene, sceneDir: '/scenes', res, segs: segments(t, res), textDir: '/tmp/democast-x', font: '/fonts/Sans-Bold.ttf' });
}

const shapes = {
  'no narration': () => argsFor({ ...take, narration: [] }, {}, edits),
  narration: () => argsFor(take, { voice: { volume: 1.2 } }, edits),
  music: () => argsFor({ ...take, narration: [] }, { music: { file: 'bed.mp3', volume: 0.4 } }, edits),
  'narration and music': () => argsFor(take, { music: 'bed.mp3' }, edits),
  'text overlay': () => argsFor(take, {}, textEdits),
};
// Snapshots need Node 23.4+ (or 22.3+ with --experimental-test-snapshots).
const [major, minor] = process.versions.node.split('.').map(Number);
const skip = !(major > 23 || (major === 23 && minor >= 4)) && 'snapshots need Node 23.4+';
for (const [name, build] of Object.entries(shapes)) {
  test(`renderArgs: ${name}`, { skip }, (t) => t.assert.snapshot(build()));
}

test('renderArgs: encodes at the take\'s frame rate', () => {
  const rate = (t) => { const a = argsFor(t, {}, edits).args; return a[a.indexOf('-r') + 1]; };
  if (rate(take) !== '30') throw new Error(`default rate ${rate(take)}`);
  if (rate({ ...take, fps: 60 }) !== '60') throw new Error(`60 fps take encoded at ${rate({ ...take, fps: 60 })}`);
});

test('renderArgs: muted tracks add no inputs and music keeps the first audio input', () => {
  const muted = argsFor(take, { music: 'bed.mp3' }, { ...edits, audio: { voice: 0, music: 0 } });
  assert.equal(muted.args.filter((arg) => arg === '-i').length, 1);
  assert.ok(!muted.args.includes('[aout]'));
  const music = argsFor(take, { voice: { volume: 0 }, music: 'bed.mp3' }, edits);
  assert.equal(music.args.filter((arg) => arg === '-i').length, 2);
  const graph = music.args[music.args.indexOf('-filter_complex') + 1];
  assert.ok(graph.includes('[1:a]aresample=48000'));
  assert.ok(!graph.includes('sidechaincompress'));
});

test('renderArgs: overlays entirely inside a cut produce no text files', () => {
  const result = argsFor(take, {}, {
    ...edits,
    regions: [...edits.regions, { type: 'text', text: 'Removed', from: at(1, 1.1), to: at(1, 1.4) }],
  });
  assert.deepEqual(result.texts, []);
  const graph = result.args[result.args.indexOf('-filter_complex') + 1];
  assert.ok(graph.includes('[vcat]null[vout]'));
});
