import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageConfig, FORMATS, TITLE_BAR } from '../src/formats.js';

const both = { browser: true, term: true };

test('view: one panel gets exactly the one-panel rectangle', () => {
  const cfg = stageConfig('16x9', { steps: [{ view: 'browser' }] }, both);
  const single = FORMATS['16x9'].single;
  assert.deepEqual(cfg.views.browser, { browser: single });
  assert.deepEqual(cfg.views.term, { term: single });
  // and a browser-only scene uses the same rectangle
  const solo = stageConfig('16x9', { steps: [] }, { browser: true });
  assert.deepEqual({ x: solo.browser.x, y: solo.browser.y, w: solo.browser.w, h: solo.browser.h }, single);
  const { scale, ...browserRect } = cfg.browser;
  assert.deepEqual(cfg.views.both, { browser: browserRect, term: cfg.term });
});

test('view: layout max uses the max rectangle', () => {
  const cfg = stageConfig('16x9', { layout: 'max', steps: [] }, both);
  assert.deepEqual(cfg.views.browser.browser, FORMATS['16x9'].max);
});

test('view: not available with one panel, two terminal panes, or 9x16 focus', () => {
  assert.equal(stageConfig('16x9', { steps: [] }, { browser: true }).views, null);
  assert.equal(stageConfig('16x9', { steps: [] }, { term: true, term2: true }).views, null);
  assert.equal(stageConfig('9x16', { steps: [] }, both).views, null);
});

test('stageConfig passes the title bar height to the stage', () => {
  assert.equal(stageConfig('16x9', { steps: [] }, { browser: true }).bar, TITLE_BAR);
  assert.equal(TITLE_BAR, 46);
});

test('9x16 layout: both stacks the panels inside the focus band; the default is one at a time', () => {
  const cfg = stageConfig('9x16', { layout: 'both', steps: [] }, both);
  const band = FORMATS['9x16'].single;
  const { browser: b, term: t } = FORMATS['9x16'].both;
  assert.ok(b.y >= band.y && t.y + t.h <= band.y + band.h, 'inside the safe band');
  assert.ok(b.y + b.h <= t.y, 'browser above terminal, not overlapping');
  assert.deepEqual([cfg.browser.y, cfg.term.y, cfg.term.h], [b.y, t.y, t.h]);
  assert.equal(stageConfig('9x16', { steps: [] }, both).term.y, band.y, 'focus: one panel in the band');
});

test('every format that has a one-panel layout can stack both panels', () => {
  for (const [name, f] of Object.entries(FORMATS)) {
    assert.doesNotThrow(() => stageConfig(name, { layout: 'both', steps: [] }, both), name);
    assert.ok(f.both?.browser && f.both?.term, `${name} defines both`);
  }
});
