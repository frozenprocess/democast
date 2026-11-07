// The side panels: the selected region, warnings and audio levels.

import {
  REGION_TYPES, SPEEDS, TEXT_POSITIONS, anchorAt, warnings,
} from '../edits.js';
import { $, clamp, esc } from './util.js';
import { state, stripIds, video } from './state.js';
import { change, deleteSelected, selectedRegion } from './edit.js';
import { renderButtons } from './render.js';
import { renderTimeline } from './timeline.js';
import { seek, updatePlayhead } from './playback.js';

export function renderInspector() {
  const el = $('inspector');
  const r = selectedRegion();
  if (!r) {
    el.innerHTML = '<p class="muted" style="margin:0">Drag on the <b>Edits</b> lane to add a region, or click one to edit it.</p>';
    return;
  }
  const anchor = (t) => {
    const a = anchorAt(state.take, t);
    return `step ${a.step} (${a.action}) + ${a.offset.toFixed(2)}s`;
  };
  el.innerHTML = `
    <div class="field"><label>Type</label>
      <select id="f-type">${REGION_TYPES.map((t) => `<option ${t === r.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${r.type === 'speed' ? `<div class="field"><label>Speed</label>
      <select id="f-factor">${SPEEDS.map((s) => `<option value="${s}" ${s === r.factor ? 'selected' : ''}>${s}×</option>`).join('')}</select></div>` : ''}
    ${r.type === 'text' ? `<div class="field"><label>Text</label><input type="text" id="f-text" value="${esc(r.text ?? '')}"></div>
      <div class="field"><label>Position</label>
      <select id="f-pos">${TEXT_POSITIONS.map((p) => `<option ${p === r.position ? 'selected' : ''}>${p}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>From</label><input type="number" id="f-from" step="0.05" min="0" value="${r.from.toFixed(2)}">
      <span class="anchor">${anchor(r.from)}</span></div>
    <div class="field"><label>To</label><input type="number" id="f-to" step="0.05" min="0" value="${r.to.toFixed(2)}">
      <span class="anchor">${anchor(r.to)}</span></div>
    <div class="row" style="margin-top:8px"><button id="f-play">▶ Play region</button><button id="f-del">Delete</button></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">${{
      cut: 'Removes this part, along with any narration in it.',
      speed: 'Plays this part faster. Narration in it is sped up too.',
      text: 'Shows a caption over the video. Keep it short: it is one line.',
    }[r.type]}</p>`;
  const upd = (fn) => change(fn);
  $('f-type').onchange = (e) => upd(() => {
    r.type = e.target.value;
    if (r.type === 'speed') r.factor ??= 2;
    if (r.type === 'text') Object.assign(r, { text: r.text ?? 'Your text here', position: r.position ?? 'bottom' });
  });
  $('f-factor')?.addEventListener('change', (e) => upd(() => { r.factor = Number(e.target.value); }));
  $('f-pos')?.addEventListener('change', (e) => upd(() => { r.position = e.target.value; }));
  // Typing updates the timeline and preview but not this panel, which
  // would lose focus; the whole edit is one undo step.
  const text = $('f-text');
  if (text) {
    text.onfocus = () => state.history.push(JSON.stringify(state.res));
    text.oninput = () => {
      r.text = text.value;
      state.future = [];
      state.dirty = true;
      renderTimeline();
      renderButtons();
      $('overlay').dataset.key = '';
      updatePlayhead();
    };
  }
  $('f-from').onchange = (e) => upd(() => { r.from = clamp(Number(e.target.value), 0, r.to - 0.05); });
  $('f-to').onchange = (e) => upd(() => { r.to = clamp(Number(e.target.value), r.from + 0.05, state.take.duration); });
  $('f-del').onclick = deleteSelected;
  $('f-play').onclick = () => {
    seek(Math.max(0, r.from - 1));
    video.play();
  };
}

export function renderWarnings() {
  const list = warnings(state.take, stripIds(state.res));
  const el = $('warnings');
  el.innerHTML = list.length ? '' : '<div class="none">None.</div>';
  for (const w of list) {
    const d = document.createElement('div');
    d.textContent = w.text;
    d.onclick = () => seek(w.at);
    el.append(d);
  }
}

export function renderAudio() {
  $('voiceVol').value = state.res.audio.voice ?? 1;
  $('musicVol').value = state.res.audio.music ?? 1;
  $('musicVol').disabled = !state.project.scene.music;
  $('musicNote').textContent = state.project.scene.music
    ? 'Music is mixed in when rendering; the preview plays voice only.'
    : 'This scene has no music. Add "music:" to the scene to use it.';
  video.volume = Math.min(1, state.res.audio.voice ?? 1);
}
