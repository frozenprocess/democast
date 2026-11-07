import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkScene } from '../src/check.js';
import { tmpDir } from './tmp.js';

const check = (scene, opts) => checkScene({ name: 't', ...scene }, opts?.dir ?? '/nowhere', { env: { HOME: '/h' }, ...opts });

test('checkScene: a ready scene has no problems and a summary', () => {
  const dir = tmpDir('check');
  writeFileSync(path.join(dir, 'logo.png'), '');
  const { problems, summary } = check({
    formats: ['16x9', '9x16'],
    steps: [
      { card: { image: 'logo.png', title: 'Hi {{env.HOME}}' } },
      { 'browser.open': 'https://example.com' },
      { 'browser.capture': { var: 'addr', selector: '#a' } },
      { 'term.run': { cmd: 'ping {{addr}}', id: 'ping', background: true } },
      { 'term.waitFor': { id: 'ping', regex: 'time=(\\S+)', var: 'rtt' } },
      { caption: 'RTT {{rtt}}' },
      { say: 'Done.' },
      { 'term.kill': 'ping' },
    ],
  }, { dir });
  assert.deepEqual(problems, []);
  assert.deepEqual(summary, ['scene t: 8 step(s)', 'panels: browser, term', 'formats: 16x9, 9x16', 'narration: 1 line(s), kokoro, 1 words']);
});

test('checkScene: finds what would stop a recording partway', () => {
  const { problems } = check({
    music: 'bed.mp3',
    browser: { profile: 'no-such-profile-for-tests', headers: { 'X-Key': '{{env.API_KEY}}' } },
    steps: [
      { caption: 'Hello {{who}}' },
      { 'term.run': { cmd: 'echo {{env.TOKEN}} {{env.TOKEN}}', capture: { var: 'who', regex: '.+' } } },
      { say: 'Hi {{who}}' },
      { card: { image: 'missing.png' } },
      { 'term.wait': 'server' },
      { view: 'browser' },
    ],
  }, { formats: ['9x16'] });
  assert.deepEqual(problems, [
    'steps[0].caption: {{who}} is used before any step captures it',
    "steps[2].say: say lines can't use variables ({{who}}); they're synthesized before the scene runs",
    'steps[4].term.wait: no earlier term.run has id "server"',
    '$TOKEN is not set (used in steps[1].term.run.cmd)',
    '$API_KEY is not set (used in browser.headers.X-Key)',
    'steps[3].card.image: no file missing.png',
    'music: no file bed.mp3',
    'browser.profile: no saved profile "no-such-profile-for-tests"; run "democast login" first',
    '9x16: view steps need a side-by-side layout with a browser and one terminal (not 9x16, not pane: 2)',
  ]);
});

test('checkScene: two terminal panes and a browser can\'t share a stage', () => {
  const { problems } = check({ site: 'https://x', steps: [{ 'term.run': { cmd: 'ls', pane: 2 } }] }, { formats: ['16x9'] });
  assert.match(problems[0], /16x9: a scene with a second terminal \(pane: 2\) can't also have a browser panel/);
});

test('checkScene: setup captures and processes remain available through teardown', () => {
  const { problems, summary } = check({
    setup: [{ 'term.run': { cmd: 'echo ready', id: 'server', capture: { var: 'state', regex: '.+' } } }],
    steps: [{ caption: '{{state}}' }],
    teardown: [{ 'term.kill': 'server' }, { caption: '{{state}}' }],
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(summary, [
    'scene t: 1 step(s), 1 setup, 2 teardown',
    'panels: term', 'formats: 16x9', 'narration: none',
  ]);
});

test('checkScene: environment diagnostics precede file and format diagnostics', () => {
  const { problems } = check({
    setup: [{ caption: '{{env.TOKEN}} {{env.TOKEN}}' }],
    steps: [{ caption: '{{env.TOKEN}}' }, { card: { image: 'missing.png', title: '{{env.TOKEN}}' } }],
    teardown: [{ caption: '{{env.TOKEN}}' }],
  }, { formats: ['unknown'] });
  assert.deepEqual(problems, [
    '$TOKEN is not set (used in setup[0].caption, steps[0].caption, steps[1].card.title and 1 more)',
    'steps[1].card.image: no file missing.png',
    'formats: unknown format unknown',
  ]);
});
