import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { findTakes, loadScene } from '../src/project.js';
import { tmpDir } from './tmp.js';

test('findTakes: a scene whose name starts another\'s gets only its own takes', () => {
  const dir = tmpDir('takes');
  const takes = [['demo', '16x9'], ['demo', '9x16'], ['demo-v2', '16x9'], ['demo-v2', '4x5']];
  for (const [scene, format] of takes) {
    writeFileSync(path.join(dir, `${scene}-${format}.take.json`), JSON.stringify({ scene, format }));
  }
  const list = (name, formats) => findTakes(dir, { name }, formats).map((t) => path.basename(t.base));
  assert.deepEqual(list('demo'), ['demo-16x9', 'demo-9x16']);
  assert.deepEqual(list('demo-v2'), ['demo-v2-16x9', 'demo-v2-4x5']);
  assert.deepEqual(list('demo', ['9x16']), ['demo-9x16']);
});

test('loadScene: names the scene after its file and accepts a valid one', () => {
  const dir = tmpDir('scene');
  const file = path.join(dir, 'my-demo.yaml');
  writeFileSync(file, 'steps:\n  - term.run: "echo hi"\n  - wait: 100\n    timeout: 5\n  - term.run: { cmd: ls, timeout: 5 }\n');
  assert.equal(loadScene(file).name, 'my-demo');
  writeFileSync(file, 'name: other\nsteps:\n  - wait: 1\n');
  assert.equal(loadScene(file).name, 'other');
});

test('loadScene: rejects malformed scenes with a message', () => {
  const dir = tmpDir('scene');
  const file = path.join(dir, 's.yaml');
  const bad = [
    ['steps: [\n', /reading .*s\.yaml/],
    ['- just a list\n', /"steps" list/],
    ['steps: []\n', /non-empty "steps"/],
    ['steps:\n  - fly: away\n', /step 0: unknown action "fly"/],
    ['steps:\n  - wait: 1\n    caption: hi\n', /step 0: want exactly one action per step/],
    ['steps:\n  - wait: 1\n  - null\n', /step 1: want exactly one action/],
    ['setup: { wait: 1 }\nsteps:\n  - wait: 1\n', /"setup" must be a list/],
    ['setup:\n  - nope: 1\nsteps:\n  - wait: 1\n', /setup step 0: unknown action "nope"/],
    ['browser: { zoom: 2 }\nsteps:\n  - wait: 1\n', /browser: unknown setting "zoom"/],
    ['browser: { auth: { username: a } }\nsteps:\n  - wait: 1\n', /browser\.auth: needs "password"/],
    ['redact: [nope]\nsteps:\n  - wait: 1\n', /redact\[0\]: want one of "email"/],
    ['remix: true\nsteps:\n  - term.run: ls\n', /step 0: unknown action "term\.run"/],
    ['remix: true\nsite: https://x\nsteps:\n  - wait: 1\n', /a remix scene has no "setup", "teardown" or "site"/],
    // Caught by the schema.
    ['steps:\n  - term.run: { cmd: ls, comand: ls }\n', /steps\[0\]\.term\.run: unknown setting "comand"/],
    ['steps:\n  - term.run: { show: ls }\n', /steps\[0\]\.term\.run: needs "cmd"/],
    ['steps:\n  - term.print: { text: hi, style: loud }\n', /steps\[0\]\.term\.print\.style: want one of "out", "err", "prompt"/],
    ['steps:\n  - wait: soon\n', /steps\[0\]\.wait: want a number, got "soon"/],
    ['steps:\n  - view: left\n', /steps\[0\]\.view: want one of "browser", "term", "both"/],
    ['formats: [16x10]\nsteps:\n  - wait: 1\n', /formats\[0\]: want one of "16x9"/],
    ['terminal: { fontSize: { 16x9: 20, 2x1: 18 } }\nsteps:\n  - wait: 1\n', /terminal\.fontSize: unknown key "2x1"/],
    ['voice: { engine: espeak }\nsteps:\n  - wait: 1\n', /voice\.engine: want one of "kokoro", "vibevoice", "command"/],
    ['tiemout: 5\nsteps:\n  - wait: 1\n', /scene: unknown setting "tiemout"/],
  ];
  for (const [yaml, msg] of bad) {
    writeFileSync(file, yaml);
    assert.throws(() => loadScene(file), msg, yaml);
  }
});
