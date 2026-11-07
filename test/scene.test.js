import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionOf, panelsFor, paneOf, panelOf, ACTION_NAMES } from '../src/scene.js';
import { ACTIONS } from '../src/actions/index.js';

test('scene inspection ignores timeout key order and includes setup panels', () => {
  const step = { timeout: 100, 'term.run': { cmd: 'echo hello', pane: 2 } };
  assert.equal(actionOf(step), 'term.run');
  assert.deepEqual(panelsFor({ setup: [step], steps: [{ caption: 'Hello' }] }), {
    browser: false, term: true, term2: true,
  });
});

test('scene inspection includes explicit panels but excludes teardown-only actions', () => {
  assert.deepEqual(panelsFor({
    site: 'https://example.com', terminal2: {}, steps: [{ wait: 1 }],
  }), { browser: true, term: true, term2: true });
  assert.deepEqual(panelsFor({
    steps: [{ caption: 'Hello' }], teardown: [{ 'term.run': 'echo goodbye' }],
  }), { browser: false, term: false, term2: false });
  assert.deepEqual(panelsFor({ steps: [{ 'browser.open': 'https://example.com' }] }), {
    browser: true, term: false, term2: false,
  });
});

test('terminal pane selection preserves defaults and rejects invalid panes', () => {
  for (const arg of [undefined, null, 'echo hello', [], {}, { pane: null }, { pane: 1 }]) {
    assert.equal(paneOf(arg), 'term');
  }
  assert.equal(paneOf({ pane: 2 }), 'term2');
  assert.throws(() => paneOf({ pane: '2' }), /pane must be 1 or 2, not "2"/);
  assert.throws(() => panelsFor({ steps: [{ 'term.clear': { pane: 3 } }] }), /pane must be 1 or 2, not 3/);
});

test('panelOf: the panel an action works on', () => {
  assert.equal(panelOf('browser.click'), 'browser');
  assert.equal(panelOf('term.run'), 'term');
  for (const a of ['card', 'caption', 'say', 'wait', 'view', 'cursor.hide']) assert.equal(panelOf(a), null);
});

test('ACTION_NAMES lists the registered actions, in order', () => {
  assert.deepEqual(ACTION_NAMES, Object.keys(ACTIONS));
});
