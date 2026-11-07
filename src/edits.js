// Edit model shared by the renderer (Node) and the timeline editor
// (browser). No Node imports.
//
// A take is one recording of one format: its duration and when each step
// started and ended (see <name>-<format>.take.json). Edits are stored
// anchored to steps rather than to seconds, e.g. "0.4s into step 12", so
// the same edits apply to every format and survive re-recording, even
// though each take's timing differs.
//
// Stored form (<scene>.edits.yaml):
//   audio: { voice: 1, music: 0.6 }
//   trim: { start: <anchor>, end: <anchor> }        # either may be omitted
//   regions:
//     - { type: cut, from: <anchor>, to: <anchor> }
//     - { type: speed, factor: 2, from: <anchor>, to: <anchor> }
//     - { type: text, text: "...", position: bottom, from: <anchor>, to: <anchor> }
// where <anchor> is { step: <index>, action: <name>, offset: <seconds> }.
//
// Resolved form (seconds in one take, used for editing and rendering):
//   { audio, trim: { start, end }, regions: [{ ...region, from, to }] }

export const REGION_TYPES = ['cut', 'speed', 'text'];
export const SPEEDS = [1.5, 2, 3, 4, 8];
export const TEXT_POSITIONS = ['top', 'center', 'bottom'];

const round = (x) => Math.round(x * 1000) / 1000;

// anchorAt returns the anchor for time t: the last step that started at or
// before t, and how far into it t is.
export function anchorAt(take, t) {
  let s = take.steps[0];
  for (const step of take.steps) {
    if (step.start <= t + 1e-6) s = step;
    else break;
  }
  return { step: s.i, action: s.action, offset: round(Math.max(0, t - s.start)) };
}

// resolve converts an anchor to seconds in take. If the step ran shorter in
// this take, the time is clamped to the start of the next step.
export function resolve(take, anchor) {
  const k = take.steps.findIndex((s) => s.i === anchor.step);
  if (k < 0) return anchor.step < take.steps[0].i ? 0 : take.duration;
  const limit = k + 1 < take.steps.length ? take.steps[k + 1].start : take.duration;
  return Math.min(take.steps[k].start + anchor.offset, limit, take.duration);
}

// checkEdits validates edits in stored form, throwing a message fit for the
// user that says where the problem is.
export function checkEdits(edits) {
  const fail = (where, msg) => { throw new Error(`edits: ${where}: ${msg}`); };
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const amount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const anchor = (a, where) => {
    if (!isObj(a)) fail(where, `want {step, action, offset}, got ${JSON.stringify(a)}`);
    if (!Number.isInteger(a.step) || a.step < 0) fail(`${where}.step`, `want a step index, got ${JSON.stringify(a.step)}`);
    if (typeof a.action !== 'string' || !a.action) fail(`${where}.action`, `want the step's action name, got ${JSON.stringify(a.action)}`);
    if (!amount(a.offset)) fail(`${where}.offset`, `want seconds >= 0, got ${JSON.stringify(a.offset)}`);
  };
  if (!isObj(edits)) fail('file', 'want a mapping with audio, trim and regions');
  if (edits.audio != null) {
    if (!isObj(edits.audio)) fail('audio', 'want { voice, music }');
    for (const k of ['voice', 'music']) {
      if (edits.audio[k] != null && !amount(edits.audio[k])) fail(`audio.${k}`, `want a volume >= 0, got ${JSON.stringify(edits.audio[k])}`);
    }
  }
  if (edits.trim != null) {
    if (!isObj(edits.trim)) fail('trim', 'want { start, end }');
    for (const k of ['start', 'end']) if (edits.trim[k] != null) anchor(edits.trim[k], `trim.${k}`);
  }
  if (edits.regions != null) {
    if (!Array.isArray(edits.regions)) fail('regions', 'want a list');
    edits.regions.forEach((r, i) => {
      const where = `regions[${i}]`;
      if (!isObj(r)) fail(where, 'want a mapping');
      if (!REGION_TYPES.includes(r.type)) fail(`${where}.type`, `want one of ${REGION_TYPES.join(', ')}, got ${JSON.stringify(r.type)}`);
      anchor(r.from, `${where}.from`);
      anchor(r.to, `${where}.to`);
      if (r.type === 'speed' && !SPEEDS.includes(r.factor)) fail(`${where}.factor`, `want one of ${SPEEDS.join(', ')}, got ${JSON.stringify(r.factor)}`);
      if (r.type === 'text') {
        if (typeof r.text !== 'string') fail(`${where}.text`, `want a string, got ${JSON.stringify(r.text)}`);
        if (r.position != null && !TEXT_POSITIONS.includes(r.position)) fail(`${where}.position`, `want one of ${TEXT_POSITIONS.join(', ')}, got ${JSON.stringify(r.position)}`);
      }
    });
  }
  return edits;
}

export function emptyEdits() {
  return { audio: { voice: 1, music: 1 }, trim: {}, regions: [] };
}

// resolveEdits turns stored edits into seconds for one take.
export function resolveEdits(take, edits = {}) {
  const trim = {
    start: edits.trim?.start ? resolve(take, edits.trim.start) : 0,
    end: edits.trim?.end ? resolve(take, edits.trim.end) : take.duration,
  };
  const regions = (edits.regions ?? []).map((r) => {
    const out = { ...r, from: resolve(take, r.from), to: resolve(take, r.to) };
    if (out.to < out.from) [out.from, out.to] = [out.to, out.from];
    return out;
  }).filter((r) => r.to - r.from > 0.01);
  return { audio: { voice: 1, music: 1, ...edits.audio }, trim, regions };
}

// anchorEdits turns edits in seconds back into the stored, anchored form.
export function anchorEdits(take, res) {
  /** @type {{ audio: any, trim: { start?: any, end?: any }, regions: any[] }} */
  const out = { audio: res.audio, trim: {}, regions: [] };
  if (res.trim.start > 0.01) out.trim.start = anchorAt(take, res.trim.start);
  if (res.trim.end < take.duration - 0.01) out.trim.end = anchorAt(take, res.trim.end);
  for (const r of res.regions) {
    const { from, to, ...rest } = r;
    out.regions.push({ ...rest, from: anchorAt(take, from), to: anchorAt(take, to) });
  }
  return out;
}

// segments lists the parts of the take that end up in the output, in
// order, with their playback speed: the trimmed range minus cuts, split
// where speed regions begin and end. Each segment is { a, b, speed,
// outStart } in source seconds, plus its start in the output.
export function segments(take, res) {
  const { start, end } = res.trim;
  const cuts = res.regions.filter((r) => r.type === 'cut');
  const speeds = res.regions.filter((r) => r.type === 'speed');
  const points = new Set([start, end]);
  for (const r of [...cuts, ...speeds]) {
    for (const t of [r.from, r.to]) if (t > start && t < end) points.add(t);
  }
  const ts = [...points].sort((x, y) => x - y);
  const segs = [];
  let outStart = 0;
  for (let k = 0; k + 1 < ts.length; k++) {
    const a = ts[k];
    const b = ts[k + 1];
    if (b - a < 1 / 60) continue;
    const mid = (a + b) / 2;
    if (cuts.some((c) => mid > c.from && mid < c.to)) continue;
    const sp = speeds.filter((s) => mid > s.from && mid < s.to).reduce((m, s) => Math.max(m, s.factor ?? 2), 1);
    const prev = segs.at(-1);
    if (prev && prev.speed === sp && Math.abs(prev.b - a) < 1e-6) {
      outStart += (b - a) / sp;
      prev.b = b;
      continue;
    }
    segs.push({ a, b, speed: sp, outStart });
    outStart += (b - a) / sp;
  }
  return segs;
}

export function outputDuration(segs) {
  const last = segs.at(-1);
  return last ? last.outStart + (last.b - last.a) / last.speed : 0;
}

// mapTime converts a source time to output time, or null if it was cut.
// With snap, a cut time maps to where the output resumes.
export function mapTime(segs, t, { snap = false } = {}) {
  for (const s of segs) {
    if (t >= s.a - 1e-6 && t <= s.b + 1e-6) return s.outStart + (Math.min(t, s.b) - s.a) / s.speed;
    if (snap && t < s.a) return s.outStart;
  }
  return snap ? outputDuration(segs) : null;
}

// mapRange maps a source range to the output, clipping out cut parts; it
// returns null if none of it survives.
export function mapRange(segs, from, to) {
  let a = null;
  let b = null;
  for (const s of segs) {
    const lo = Math.max(from, s.a);
    const hi = Math.min(to, s.b);
    if (hi <= lo) continue;
    if (a === null) a = s.outStart + (lo - s.a) / s.speed;
    b = s.outStart + (hi - s.a) / s.speed;
  }
  return a === null ? null : { from: a, to: b };
}

// warnings points out edits that cut into or speed up narration.
export function warnings(take, res) {
  const out = [];
  const lines = take.narration ?? [];
  const short = (text) => (text.length > 40 ? text.slice(0, 38) + '…' : text);
  const inside = (t, n) => t > n.start + 0.05 && t < n.start + n.duration - 0.05;
  const edges = [
    ...res.regions.filter((r) => r.type === 'cut').flatMap((r) => [[r.from, 'cut'], [r.to, 'cut']]),
    [res.trim.start, 'trim'],
    [res.trim.end, 'trim'],
  ];
  for (const n of lines) {
    for (const [t, kind] of edges) {
      if (inside(t, n)) out.push({ at: t, text: `A ${kind} at ${t.toFixed(1)}s splits the line "${short(n.text)}"` });
    }
    for (const r of res.regions.filter((x) => x.type === 'speed')) {
      if (r.from < n.start + n.duration && r.to > n.start) {
        out.push({ at: r.from, text: `The ${r.factor}× speed-up at ${r.from.toFixed(1)}s also speeds up "${short(n.text)}"` });
      }
    }
  }
  return out;
}
