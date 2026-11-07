import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRemix, METHOD_OF, RemixBuilder } from '../src/remix.js';
import { REMIX_ACTIONS } from '../src/scene.js';
import { FORMATS } from '../src/formats.js';
import { tmpDir } from './tmp.js';

// A kept take: a 16x9 browser + terminal take, site frames every second,
// the pointer at the page's center at 2 s, a print at 3 s.
function take() {
  const dir = tmpDir('remix');
  const logDir = path.join(dir, 'a-16x9.log');
  mkdirSync(logDir);
  const t0 = 5000;
  const browser = { x: 70, y: 190, w: 1020, h: 830, scale: 1.2 };
  const cfg = { w: 1920, h: 1080, browser, term: { x: 1130, y: 190, w: 720, h: 830 }, termTitle: 'bash' };
  const cx = browser.x + browser.w / 2, cy = browser.y + 46 + (browser.h - 46) / 2;
  writeFileSync(path.join(logDir, 'log.json'), JSON.stringify({
    scene: 'a', format: '16x9', scale: 1, fps: 30, t0, duration: 6, cfg,
    events: [
      { t: t0 - 10, fn: 'init', args: [cfg] },
      { t: t0 + 500, fn: 'print', args: ['before\n', 'out', 'term'] },
      { t: t0 + 2000, fn: 'moveTo', args: [cx, cy] },
      { t: t0 + 3000, fn: 'print', args: ['during\n', 'out', 'term'] },
    ],
    frames: [0, 1, 2, 3, 4, 5].map((s) => ({ t: t0 + s * 1000, file: `${s}.jpg` })),
  }));
  return dir;
}

const scene = (steps) => ({ name: 'r', remix: true, takes: { a: 'a-16x9' }, steps });

test('buildRemix: a browser clip takes the frames in range, on the new clock, the pointer through the zoom box', () => {
  const dir = take();
  const r = buildRemix({ scene: scene([
    { wait: 1000 },
    { clip: { take: 'a', window: 'browser', from: 1.5, to: 3.5, zoom: { x: 0.25, y: 0, w: 0.5 } } },
  ]), sceneDir: dir, format: '9x16' });
  assert.equal(r.duration, 3.3); // 1 s wait + 2 s clip + 0.3 s
  // The frame up at 1.5 s (1.jpg) at the clip's start, then 2 and 3.
  assert.deepEqual(r.frames.map((f) => [f.t - r.t0, path.basename(f.file)]), [[1000, '1.jpg'], [1500, '2.jpg'], [2500, '3.jpg']]);
  const box = r.events.find((e) => e.fn === 'siteBox').args[0];
  assert.equal(box.x, 0.25);
  assert.equal(box.w, 0.5);
  // The page's center is the box's center.
  const mv = r.events.find((e) => e.fn === 'moveTo');
  const b = FORMATS['9x16'].single;
  assert.equal(mv.t - r.t0, 1500);
  assert.ok(Math.abs(mv.args[0] - (b.x + b.w / 2)) < 0.01);
  const siteH = b.h - 46;
  const v = (0.5 - box.y) / box.h;
  assert.ok(Math.abs(mv.args[1] - (b.y + 46 + v * siteH)) < 0.01);
});

test('buildRemix: a terminal clip starts with the screen as it was, then what follows, faster with speed', () => {
  const dir = take();
  const r = buildRemix({ scene: scene([{ clip: { take: 'a', window: 'term', from: 1, to: 5, speed: 2 } }]), sceneDir: dir, format: '9x16' });
  const prints = r.events.filter((e) => e.fn === 'print').map((e) => [e.t - r.t0, e.args[0]]);
  assert.deepEqual(prints, [[0, '$ '], [0, 'before\n'], [1000, 'during\n']]);
  assert.equal(r.duration, 2.3);
  assert.ok(r.events.some((e) => e.fn === 'termReset'));
});

test('buildRemix: rejects a clip without a range', () => {
  assert.throws(() => buildRemix({ scene: scene([{ clip: { take: 'a', from: 3, to: 2 } }]), sceneDir: take(), format: '9x16' }), /from < to/);
});

test('every remix action has a builder method, and the other way round', () => {
  assert.deepEqual(Object.keys(METHOD_OF).sort(), [...REMIX_ACTIONS].sort());
  for (const [action, method] of Object.entries(METHOD_OF)) {
    assert.equal(typeof RemixBuilder.prototype[method], 'function', `${action} -> ${method}`);
  }
});
