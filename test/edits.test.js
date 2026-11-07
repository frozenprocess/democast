import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorAt, resolve, resolveEdits, anchorEdits, segments, outputDuration, mapTime, mapRange, warnings, emptyEdits, checkEdits,
} from '../src/edits.js';

// Two takes of the same three steps, the second slower.
const fast = {
  duration: 10,
  steps: [
    { i: 0, action: 'card', start: 0, end: 0 },
    { i: 1, action: 'wait', start: 0, end: 4 },
    { i: 2, action: 'term.run', start: 4, end: 10 },
  ],
  narration: [{ text: 'hello there', start: 1, duration: 2 }],
};
const slow = {
  duration: 16,
  steps: [
    { i: 0, action: 'card', start: 0, end: 0 },
    { i: 1, action: 'wait', start: 0, end: 6 },
    { i: 2, action: 'term.run', start: 6, end: 16 },
  ],
  narration: [],
};

test('anchors pick the step that started last', () => {
  assert.deepEqual(anchorAt(fast, 5), { step: 2, action: 'term.run', offset: 1 });
  assert.deepEqual(anchorAt(fast, 0), { step: 1, action: 'wait', offset: 0 });
});

test('anchors move with their step in another take', () => {
  const a = anchorAt(fast, 5); // 1s into term.run
  assert.equal(resolve(slow, a), 7);
});

test('anchors clamp to the next step when a step ran shorter', () => {
  assert.equal(resolve(fast, { step: 1, action: 'wait', offset: 5.5 }), 4);
  assert.equal(resolve(fast, { step: 99, action: 'x', offset: 0 }), 10);
});

test('edits round-trip through the anchored form', () => {
  const res = {
    ...emptyEdits(),
    trim: { start: 0.5, end: 9 },
    regions: [{ type: 'cut', from: 2, to: 3 }, { type: 'text', text: 'hi', position: 'top', from: 5, to: 6 }],
  };
  const back = resolveEdits(fast, anchorEdits(fast, res));
  assert.deepEqual(back.trim, { start: 0.5, end: 9 });
  assert.deepEqual(back.regions.map((r) => [r.type, r.from, r.to]), [['cut', 2, 3], ['text', 5, 6]]);
  assert.equal(back.regions[1].text, 'hi');
});

test('segments drop cuts and trims and apply speed-ups', () => {
  const res = {
    ...emptyEdits(),
    trim: { start: 1, end: 9 },
    regions: [{ type: 'cut', from: 2, to: 3 }, { type: 'speed', factor: 2, from: 5, to: 7 }],
  };
  const segs = segments(fast, res);
  assert.deepEqual(segs.map((s) => [s.a, s.b, s.speed]), [[1, 2, 1], [3, 5, 1], [5, 7, 2], [7, 9, 1]]);
  // 1 + 2 + 1 (2s at 2x) + 2
  assert.equal(outputDuration(segs), 6);
  assert.equal(mapTime(segs, 2.5), null);
  assert.equal(mapTime(segs, 2.5, { snap: true }), 1);
  assert.equal(mapTime(segs, 6), 3.5); // 1s into the 2x part, which starts at 3
  assert.deepEqual(mapRange(segs, 1.5, 3.5), { from: 0.5, to: 1.5 });
});

test('overlapping speed-ups use the faster one, and cuts win over speed', () => {
  const res = {
    ...emptyEdits(),
    trim: { start: 0, end: 10 },
    regions: [
      { type: 'speed', factor: 2, from: 0, to: 6 },
      { type: 'speed', factor: 4, from: 2, to: 4 },
      { type: 'cut', from: 5, to: 8 },
    ],
  };
  assert.deepEqual(segments(fast, res).map((s) => [s.a, s.b, s.speed]), [[0, 2, 2], [2, 4, 4], [4, 5, 2], [8, 10, 1]]);
});

test('warnings flag cuts that split narration and speed-ups over it', () => {
  const res = { ...emptyEdits(), trim: { start: 0, end: 10 }, regions: [{ type: 'cut', from: 2, to: 5 }] };
  assert.match(warnings(fast, res)[0].text, /splits the line "hello there"/);
  const sp = { ...emptyEdits(), trim: { start: 0, end: 10 }, regions: [{ type: 'speed', factor: 2, from: 0, to: 1.5 }] };
  assert.match(warnings(fast, sp)[0].text, /speeds up "hello there"/);
  const clean = { ...emptyEdits(), trim: { start: 0, end: 10 }, regions: [{ type: 'cut', from: 4, to: 5 }] };
  assert.deepEqual(warnings(fast, clean), []);
});

test('checkEdits: accepts what the editor saves', () => {
  const res = {
    audio: { voice: 0.8, music: 0 },
    trim: { start: 0.5, end: 9 },
    regions: [
      { type: 'cut', from: 1, to: 2 },
      { type: 'speed', factor: 4, from: 4, to: 6 },
      { type: 'text', text: 'Hi', position: 'top', from: 5, to: 7 },
    ],
  };
  assert.doesNotThrow(() => checkEdits(anchorEdits(fast, res)));
  assert.doesNotThrow(() => checkEdits(emptyEdits()));
  assert.doesNotThrow(() => checkEdits({}));
});

test('checkEdits: rejects malformed edits, saying where', () => {
  const at = { step: 1, action: 'wait', offset: 0 };
  const bad = [
    [[], /edits: file/],
    [{ audio: { voice: -1 } }, /audio\.voice: want a volume >= 0/],
    [{ audio: { music: 'loud' } }, /audio\.music/],
    [{ trim: { start: { step: 1, action: 'wait' } } }, /trim\.start\.offset/],
    [{ regions: {} }, /regions: want a list/],
    [{ regions: [{ type: 'blur', from: at, to: at }] }, /regions\[0\]\.type: want one of cut, speed, text/],
    [{ regions: [{ type: 'speed', factor: 5, from: at, to: at }] }, /regions\[0\]\.factor/],
    [{ regions: [{ type: 'text', text: 'x', position: 'left', from: at, to: at }] }, /regions\[0\]\.position/],
    [{ regions: [{ type: 'cut', from: at, to: { step: -1, action: 'wait', offset: 0 } }] }, /regions\[0\]\.to\.step/],
    [{ regions: [{ type: 'cut', from: at }] }, /regions\[0\]\.to: want \{step, action, offset\}/],
  ];
  for (const [edits, msg] of bad) assert.throws(() => checkEdits(edits), msg, JSON.stringify(edits));
});

test('segments: overlapping cuts, a trim inside a cut, zero-length regions', () => {
  const edits = (trim, regions) => ({ ...emptyEdits(), trim, regions });
  const spans = (res) => segments(fast, res).map((s) => [s.a, s.b, s.speed]);
  // Two cuts that overlap remove their union.
  assert.deepEqual(spans(edits({ start: 0, end: 10 }, [{ type: 'cut', from: 2, to: 5 }, { type: 'cut', from: 4, to: 7 }])), [[0, 2, 1], [7, 10, 1]]);
  // The trim starts inside a cut: the output starts where the cut ends.
  assert.deepEqual(spans(edits({ start: 3, end: 10 }, [{ type: 'cut', from: 2, to: 5 }])), [[5, 10, 1]]);
  // Zero-length cuts and speed-ups change nothing.
  assert.deepEqual(spans(edits({ start: 0, end: 10 }, [{ type: 'cut', from: 4, to: 4 }, { type: 'speed', factor: 2, from: 6, to: 6 }])), [[0, 10, 1]]);
});

test('segments: everything cut leaves nothing, and times map to the end', () => {
  const res = { ...emptyEdits(), trim: { start: 1, end: 9 }, regions: [{ type: 'cut', from: 0, to: 10 }] };
  const segs = segments(fast, res);
  assert.deepEqual(segs, []);
  assert.equal(outputDuration(segs), 0);
  assert.equal(mapTime(segs, 5), null);
  assert.equal(mapTime(segs, 5, { snap: true }), 0);
  assert.equal(mapRange(segs, 0, 10), null);
});

test('mapTime: times after the trimmed end snap to the output end', () => {
  const segs = segments(fast, { ...emptyEdits(), trim: { start: 0, end: 6 }, regions: [{ type: 'speed', factor: 3, from: 0, to: 3 }] });
  assert.equal(outputDuration(segs), 4);
  assert.equal(mapTime(segs, 8), null);
  assert.equal(mapTime(segs, 8, { snap: true }), 4);
});
