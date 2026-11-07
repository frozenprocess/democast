import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { timeline, TakeLog } from '../src/replay.js';
import { tmpDir } from './tmp.js';

const call = (t, fn) => ({ t, fn, args: [] });
const frame = (t) => ({ t, file: `${t}.jpg` });
const show = (items) => items.map((it) => (it.call ? `${it.call.fn}@${it.t}` : `frame@${it.t}`));

test('timeline orders calls and frames by time, calls first on a tie', () => {
  const items = timeline([call(0, 'init'), call(50, 'type')], [frame(50), frame(10)], [0, 100]);
  assert.deepEqual(show(items), ['init@0', 'frame@10', 'type@50', 'frame@50']);
});

test('timeline drops site frames replaced before they could be seen', () => {
  // Video frames at 0, 33, 66: frames 40 and 50 both land in the one at
  // 66, so only 50 is drawn.
  const items = timeline([], [frame(10), frame(40), frame(50), frame(70)], [0, 33, 66, 100]);
  assert.deepEqual(show(items), ['frame@10', 'frame@50', 'frame@70']);
});

test('timeline keeps a frame that a call separates from the next', () => {
  const items = timeline([call(45, 'moveTo')], [frame(40), frame(50)], [0, 33, 66]);
  assert.deepEqual(show(items), ['frame@40', 'moveTo@45', 'frame@50']);
});

test('frames before the recording starts collapse to the last one', () => {
  const items = timeline([call(-500, 'init')], [frame(-400), frame(-200), frame(-10)], [0, 33]);
  assert.deepEqual(show(items), ['init@-500', 'frame@-10']);
});

test('TakeLog skips queries and stops at close', async () => {
  const dir = path.join(tmpDir('test'), 'frames');
  const log = new TakeLog(dir);
  log.call('print', ['hi', 'out', 'term']);
  log.call('siteRect', []);
  log.frame(Buffer.from('jpeg').toString('base64'));
  await log.close();
  log.call('print', ['late']);
  log.frame(Buffer.from('late').toString('base64'));
  assert.deepEqual(log.events.map((e) => e.fn), ['print']);
  assert.equal(log.frames.length, 1);
  assert.equal(readFileSync(log.frames[0].file, 'utf8'), 'jpeg');
  log.remove();
  assert.equal(existsSync(dir), false);
});
