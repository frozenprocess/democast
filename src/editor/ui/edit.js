// Changing the edits: undo and redo, adding and deleting regions, saving
// and rendering.

import {
  anchorEdits,
} from '../edits.js';
import { $, clamp, setStatus } from './util.js';
import { JSON_HEADERS, newId, state, stripIds, video } from './state.js';
import { render, renderButtons } from './render.js';

export function change(fn, { record = true } = {}) {
  if (record) {
    state.history.push(JSON.stringify(state.res));
    if (state.history.length > 200) state.history.shift();
    state.future = [];
  }
  fn(state.res);
  state.dirty = true;
  render();
}

export function undo() {
  if (!state.history.length) return;
  state.future.push(JSON.stringify(state.res));
  state.res = JSON.parse(state.history.pop());
  if (!state.res.regions.some((r) => r.id === state.selected)) state.selected = null;
  state.dirty = true;
  render();
}

export function redo() {
  if (!state.future.length) return;
  state.history.push(JSON.stringify(state.res));
  state.res = JSON.parse(state.future.pop());
  state.dirty = true;
  render();
}

export function addRegion(type, at = video.currentTime, len = type === 'text' ? 3 : 2) {
  const from = clamp(at, 0, state.take.duration - 0.1);
  const to = clamp(from + len, from + 0.1, state.take.duration);
  const r = { id: newId(), type, from, to };
  if (type === 'speed') r.factor = 2;
  if (type === 'text') Object.assign(r, { text: 'Your text here', position: 'bottom' });
  change((res) => res.regions.push(r));
  state.selected = r.id;
  render();
  if (type === 'text') {
    $('f-text')?.focus();
    $('f-text')?.select();
  }
}

export function selectedRegion() {
  return state.res?.regions.find((r) => r.id === state.selected) ?? null;
}

export async function save() {
  state.anchored = anchorEdits(state.take, stripIds(state.res));
  const r = await fetch('/api/edits', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(state.anchored) });
  if (!r.ok) throw new Error((await r.json()).error);
  state.dirty = false;
  setStatus(`Saved to ${state.project.editsFile}`, 'ok');
  renderButtons();
}

export async function renderTakes(ids) {
  try {
    await save();
  } catch (err) {
    return setStatus(`Save failed: ${err.message}`, 'err');
  }
  $('renderOne').disabled = $('renderAll').disabled = true;
  const done = [];
  try {
    const r = await fetch('/api/render', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) });
    if (!r.ok) throw new Error((await r.json()).error);
    const reader = /** @type {any} */ (r.body).pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (msg.status === 'rendering') setStatus(`Rendering ${msg.id}…`);
        if (msg.status === 'failed') throw new Error(`${msg.id}: ${msg.error}`);
        if (msg.status === 'done') done.push(msg);
      }
    }
    const last = done.at(-1);
    setStatus(`Rendered ${done.length} file${done.length === 1 ? '' : 's'}: ${done.map((d) => d.file).join(', ')}`, 'ok');
    if (last && ids.length === 1) window.open(`/output/${encodeURIComponent(last.id)}?t=${Date.now()}`, '_blank');
  } catch (err) {
    setStatus(`Render failed: ${err.message}`, 'err');
  } finally {
    $('renderOne').disabled = $('renderAll').disabled = false;
  }
}

export function deleteSelected() {
  const r = selectedRegion();
  if (!r) return;
  change((res) => { res.regions = res.regions.filter((x) => x !== r); });
  state.selected = null;
  render();
}
