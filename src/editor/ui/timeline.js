// The timeline: lanes, steps, narration, edit regions and the waveform.

import { $, fmt } from './util.js';
import { LANES, scroller, state, tAt, tracks, x } from './state.js';
import { change } from './edit.js';
import { drag, pxIn, snap, startCreateDrag, startRegionDrag, startScrub } from './drag.js';
import { seek } from './playback.js';

export function renderTimeline() {
  const take = state.take;
  tracks.style.width = Math.max(scroller.clientWidth, x(take.duration) + 60) + 'px';
  tracks.innerHTML = '';
  const lane = makeLanes();
  drawRuler(lane.ruler, take);
  drawSteps(lane.steps, take);
  drawCaptions(lane.captions, take);
  drawNarration(lane.narration, take);
  drawRegions(lane.edits);
  drawTrim(take);

  const ph = document.createElement('div');
  ph.id = 'playhead';
  tracks.append(ph);
  lane.ruler.addEventListener('pointerdown', startScrub);
  for (const id of ['captions', 'steps', 'narration']) lane[id].addEventListener('pointerdown', startScrub);
}

// makeLanes adds the empty lanes to the timeline, top to bottom, and
// returns them by id.
function makeLanes() {
  let top = 0;
  const lane = {};
  for (const l of LANES) {
    const el = document.createElement('div');
    el.className = 'lane';
    el.id = 'lane-' + l.id;
    if (l.id === 'ruler') el.id = 'ruler';
    el.style.top = top + 'px';
    el.style.height = l.h + 'px';
    if (l.name) el.innerHTML = `<span class="laneName">${l.name}</span>`;
    tracks.append(el);
    lane[l.id] = el;
    top += l.h;
  }
  return lane;
}

// drawRuler adds time ticks, at an interval that keeps labels readable.
function drawRuler(ruler, take) {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * state.pps >= 60) ?? 60;
  for (let t = 0; t <= take.duration + 1e-6; t += step) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = x(t) + 'px';
    tick.innerHTML = `<span>${fmt(t)}</span>`;
    ruler.append(tick);
  }
}

// drawSteps adds the take's steps, colored by kind. Instant steps get a
// sliver so they're visible.
function drawSteps(lane, take) {
  for (const s of take.steps) {
    if (s.action === 'card' && s.end === 0) continue;
    const kind = s.action.startsWith('browser.') ? 'browser' : s.action.startsWith('term.') ? 'term' : s.action === 'say' ? 'say' : 'stage';
    const b = block(lane, `block k-${kind}`, s.start, Math.max(s.end, s.start + 0.05), s.action + (s.label ? ': ' + s.label : ''));
    b.title = `step ${s.i}: ${s.action}${s.label ? '\n' + s.label : ''}\n${s.start.toFixed(2)}s – ${s.end.toFixed(2)}s`;
  }
}

// drawCaptions adds captions and cards; each lasts until the next one.
function drawCaptions(lane, take) {
  const caps = take.steps.filter((s) => s.action === 'caption' || s.action === 'card');
  caps.forEach((s, k) => {
    const end = caps[k + 1]?.start ?? take.duration;
    if (end - s.start < 0.05 || !s.label) return;
    block(lane, 'block cap', s.start, end, (s.action === 'card' ? 'Card: ' : '') + s.label).title = s.label;
  });
}

// drawNarration adds the narration clips over the waveform.
function drawNarration(lane, take) {
  const wave = document.createElement('canvas');
  wave.id = 'wave';
  lane.append(wave);
  for (const n of take.narration) block(lane, 'block narr', n.start, n.start + n.duration, n.text).title = n.text;
  drawWave();
}

// drawRegions adds the edit regions, with overlapping ones stacked in rows,
// and a shade over each cut.
function drawRegions(lane) {
  const rowOf = new Map();
  const rowEnds = [];
  for (const r of [...state.res.regions].sort((a, b) => a.from - b.from)) {
    let row = rowEnds.findIndex((end) => end <= r.from + 1e-6);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = r.to;
    rowOf.set(r.id, row);
  }
  const laneH = /** @type {{ h: number }} */ (LANES.find((l) => l.id === 'edits')).h - 23;
  const rowH = laneH / Math.max(1, rowEnds.length);
  for (const r of state.res.regions) {
    const el = document.createElement('div');
    el.className = `region ${r.type}${r.id === state.selected ? ' sel' : ''}`;
    el.style.top = 18 + rowOf.get(r.id) * rowH + 'px';
    el.style.height = Math.max(8, rowH - 2) + 'px';
    el.style.lineHeight = Math.max(8, rowH - 6) + 'px';
    el.style.left = x(r.from) + 'px';
    el.style.width = Math.max(4, x(r.to) - x(r.from)) + 'px';
    el.textContent = r.type === 'cut' ? 'Cut' : r.type === 'speed' ? `${r.factor}×` : r.text;
    el.title = `${r.type} ${r.from.toFixed(2)}s – ${r.to.toFixed(2)}s`;
    el.innerHTML += '<div class="h l"></div><div class="h r"></div>';
    el.addEventListener('pointerdown', (e) => startRegionDrag(e, r));
    lane.append(el);
    if (r.type === 'cut') {
      const sh = document.createElement('div');
      sh.className = 'cutShade';
      sh.style.left = x(r.from) + 'px';
      sh.style.width = x(r.to - r.from) + 'px';
      tracks.append(sh);
    }
  }
  lane.addEventListener('pointerdown', startCreateDrag);
}

// drawTrim shades the trimmed-away ends and adds their handles.
function drawTrim(take) {
  const { start, end } = state.res.trim;
  shade(0, start);
  shade(end, take.duration);
  trimHandle('start', start);
  trimHandle('end', end);
}

export function block(parent, cls, from, to, text) {
  const el = document.createElement('div');
  el.className = cls;
  el.style.left = x(from) + 'px';
  el.style.width = Math.max(3, x(to) - x(from) - 1) + 'px';
  el.textContent = text;
  parent.append(el);
  return el;
}

export function shade(from, to) {
  if (to - from < 0.001) return;
  const el = document.createElement('div');
  el.className = 'shade';
  el.style.left = x(from) + 'px';
  el.style.width = x(to - from) + 'px';
  tracks.append(el);
}

export function trimHandle(which, t) {
  const el = document.createElement('div');
  el.className = 'trimHandle';
  el.style.left = x(t) + 'px';
  el.title = `Trim ${which}: drag to change`;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    let first = true;
    drag(e, (ev) => {
      let t2 = snap(tAt(pxIn(ev)), ev);
      t2 = which === 'start' ? Math.min(t2, state.res.trim.end - 0.2) : Math.max(t2, state.res.trim.start + 0.2);
      change((res) => { res.trim[which] = t2; }, { record: first });
      first = false;
      seek(t2);
    });
  });
  tracks.append(el);
}

export function drawWave() {
  const c = $('wave');
  const w = state.wave.get(state.take?.id);
  if (!c || !w) return;
  const width = Math.ceil(x(state.take.duration));
  const h = c.parentElement.clientHeight - 23;
  c.width = width;
  c.height = h;
  c.style.width = width + 'px';
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(219, 97, 162, .55)';
  const per = state.pps / w.rate; // px per peak
  for (let k = 0; k < w.peaks.length; k++) {
    const v = Math.min(1, w.peaks[k] * 1.6);
    const ph = Math.max(1, v * (h - 2));
    g.fillRect(k * per, (h - ph) / 2, Math.max(1, per - 0.3), ph);
  }
}
