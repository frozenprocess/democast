// A folder of takes may come from someone else: the media paths in its
// take and log files must stay inside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { inside } from '../src/util.js';
import { readTake } from '../src/take.js';
import { readTakeLog } from '../src/replay.js';
import { placeClips } from '../src/filters.js';
import { checkLoginUrls } from '../src/browser.js';
import { tmpDir } from './tmp.js';

test('inside: paths under the folder pass, anything else throws', () => {
  const d = path.resolve('/x/out');
  assert.equal(inside(d, 'a/b.wav', 'f'), path.join(d, 'a', 'b.wav'));
  assert.equal(inside(d, path.join(d, 'c.wav'), 'f'), path.join(d, 'c.wav'), 'absolute but inside (older takes)');
  for (const bad of ['../x.wav', 'a/../../x.wav', '/etc/passwd', '..']) assert.throws(() => inside(d, bad, 'f'), /outside/, bad);
});

test('readTake: a narration clip outside the take\'s folder is refused', () => {
  const dir = tmpDir('untrusted');
  const write = (file) => {
    const f = path.join(dir, 'a-16x9.take.json');
    writeFileSync(f, JSON.stringify({ narration: [{ file, text: 't', start: 0, duration: 1 }] }));
    return f;
  };
  assert.equal(readTake(write('a-16x9.narration/01.wav')).narration[0].file, path.join(dir, 'a-16x9.narration', '01.wav'));
  assert.throws(() => readTake(write('/etc/passwd')), /a-16x9\.take\.json: narration clip: .*outside/);
  assert.throws(() => readTake(write('../../etc/passwd')), /outside/);
});

test('readTakeLog: a frame outside the log\'s folder is refused', () => {
  const dir = tmpDir('untrusted');
  mkdirSync(dir, { recursive: true });
  const write = (file) => writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ events: [], frames: [{ t: 1, file }] }));
  write('000001.jpg');
  assert.equal(readTakeLog(dir).frames[0].file, path.join(dir, '000001.jpg'));
  write('../../../etc/passwd');
  assert.throws(() => readTakeLog(dir), /frame: .*outside/);
});

test('narration clips are read as plain files only', () => {
  const { args } = placeClips([{ file: '/o/01.wav', start: 0 }], 1, () => 'n');
  assert.deepEqual(args, ['-protocol_whitelist', 'file', '-i', '/o/01.wav']);
});

test('checkLoginUrls: only http(s) URLs, never something Chrome would take as a flag', () => {
  assert.doesNotThrow(() => checkLoginUrls(['https://a.test/', 'http://localhost:3000/login']));
  for (const bad of ['--renderer-cmd-prefix=touch /tmp/x', 'file:///etc/passwd', 'javascript:alert(1)', 'a.test', '']) {
    assert.throws(() => checkLoginUrls(['https://a.test/', bad]), /http\(s\) URLs/, bad);
  }
});
