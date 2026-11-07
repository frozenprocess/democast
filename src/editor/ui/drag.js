// Pointer interaction on the timeline: scrubbing, creating, moving and
// resizing regions.

import { clamp } from './util.js';
import { SNAP_PX, newId, state, tAt, tracks, video, x } from './state.js';
import { change } from './edit.js';
import { render } from './render.js';
import { seek } from './playback.js';

export function pxIn(e) {
  return e.clientX - tracks.getBoundingClientRect().left;
}

// drag tracks the pointer on window until release, since the timeline is
// re-rendered (and the dragged element replaced) as it moves.
export function drag(e, onMove, onEnd) {
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onEnd?.(ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// snap pulls t to nearby step boundaries, narration, region edges, trim
// points and the playhead, unless Alt is held.
export function snap(t, e, ignore) {
  if (e?.altKey) return t;
  const pts = [0, state.take.duration, video.currentTime, state.res.trim.start, state.res.trim.end];
  for (const s of state.take.steps) pts.push(s.start, s.end);
  for (const n of state.take.narration) pts.push(n.start, n.start + n.duration);
  for (const r of state.res.regions) if (r.id !== ignore) pts.push(r.from, r.to);
  let best = t;
  let dist = SNAP_PX / state.pps;
  for (const p of pts) {
    if (Math.abs(p - t) < dist) {
      dist = Math.abs(p - t);
      best = p;
    }
  }
  return best;
}

export function startScrub(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  seek(tAt(pxIn(e)));
  drag(e, (ev) => seek(tAt(pxIn(ev))));
}

export function startCreateDrag(e) {
  if (e.button !== 0 || e.target !== e.currentTarget && !e.target.classList.contains('laneName')) return;
  e.preventDefault();
  const t0 = snap(tAt(pxIn(e)), e);
  let r = null;
  drag(e, (ev) => {
    const t1 = snap(tAt(pxIn(ev)), ev, r?.id);
    if (!r) {
      if (Math.abs(x(t1) - x(t0)) < 4) return;
      r = { id: newId(), type: 'cut', from: t0, to: t0 };
      change((res) => res.regions.push(r));
      state.selected = r.id;
    }
    change(() => {
      r.from = Math.min(t0, t1);
      r.to = Math.max(t0, t1);
    }, { record: false });
  }, () => {
    if (!r) {
      state.selected = null;
      seek(t0);
      render();
    }
  });
}

export function startRegionDrag(e, r) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  state.selected = r.id;
  const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
  const startT = tAt(pxIn(e));
  const { from, to } = r;
  let moved = false;
  render();
  drag(e, (ev) => {
    const t = tAt(pxIn(ev));
    if (!moved && Math.abs(x(t) - x(startT)) < 3) return;
    change(() => {
      if (mode === 'l') r.from = Math.min(snap(t, ev, r.id), r.to - 0.05);
      else if (mode === 'r') r.to = Math.max(snap(t, ev, r.id), r.from + 0.05);
      else {
        const len = to - from;
        let nf = clamp(from + (t - startT), 0, state.take.duration - len);
        const sf = snap(nf, ev, r.id);
        const se = snap(nf + len, ev, r.id);
        if (sf !== nf) nf = sf;
        else if (se !== nf + len) nf = se - len;
        r.from = nf;
        r.to = nf + len;
      }
    }, { record: !moved });
    moved = true;
  }, () => {
    if (!moved) seek(r.from);
  });
}
