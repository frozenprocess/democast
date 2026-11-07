import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interp, lookup } from '../src/vars.js';
import { respell, srt } from '../src/tts.js';
import { atempo } from '../src/filters.js';

test('interp: fills {{vars}} through strings, lists and mappings', () => {
  const vars = { addr: 'tail1234', n: 3, env: { HOME: '/home/x' } };
  assert.equal(interp('send to {{ addr }} x{{n}}', vars), 'send to tail1234 x3');
  assert.deepEqual(interp({ cmd: ['echo', '{{env.HOME}}'], keep: 4, none: null }, vars), { cmd: ['echo', '/home/x'], keep: 4, none: null });
  assert.equal(interp('{not a var}', vars), '{not a var}');
});

test('lookup: names a missing variable', () => {
  assert.throws(() => lookup({ env: {} }, 'env.MISSING'), /undefined variable \{\{env\.MISSING\}\}/);
  assert.throws(() => interp('{{who}}', {}), /\{\{who\}\}/);
  assert.equal(lookup({ a: { b: 0 } }, 'a.b'), '0');
});

test('respell: whole words only, keeping the rest', () => {
  const p = { tailground: 'Tail ground', 'C++': 'C plus plus' };
  assert.equal(respell('tailground and tailground, tailgrounds, my-tailground. C++!', p), 'Tail ground and Tail ground, tailgrounds, my-tailground. C plus plus!');
  assert.equal(respell('unchanged'), 'unchanged');
});

test('srt: numbered cues with hour-minute-second-millisecond times', () => {
  assert.equal(srt([{ text: 'Hi', start: 0, duration: 1.25 }, { text: 'Later', start: 3661.5, duration: 2 }]),
    '1\n00:00:00,000 --> 00:00:01,250\nHi\n\n2\n01:01:01,500 --> 01:01:03,500\nLater\n');
  assert.equal(srt([]), '');
});

test('atempo: chains filters, each at most 2x', () => {
  assert.equal(atempo(1), '');
  assert.equal(atempo(1.5), ',atempo=1.5');
  assert.equal(atempo(3), ',atempo=2,atempo=1.5');
  assert.equal(atempo(8), ',atempo=2,atempo=2,atempo=2');
});
