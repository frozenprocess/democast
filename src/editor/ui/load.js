// Loading the project, and switching between takes.

import {
  resolveEdits, anchorEdits,
} from '../edits.js';
import { $, esc, setStatus } from './util.js';
import { scroller, state, stripIds, video, withIds } from './state.js';
import { render } from './render.js';
import { drawWave } from './timeline.js';
import { fitFrame } from './playback.js';

export async function load() {
  const r = await fetch('/api/project');
  const p = await r.json();
  state.project = p;
  $('sceneName').textContent = p.scene.path;
  document.title = `${p.scene.name} — democast editor`;
  if (!p.takes.length) {
    /** @type {HTMLElement} */ (document.querySelector('main')).innerHTML = `<div id="empty">No recorded takes of <b>${esc(p.scene.name)}</b> yet.<br><br>` +
      `Record one first: <code>democast ${esc(p.scene.path)}</code>, then reload this page.</div>`;
    return;
  }
  state.anchored = p.edits;
  const takes = $('takes');
  takes.innerHTML = '';
  for (const t of p.takes) {
    const b = document.createElement('button');
    b.textContent = t.format + (t.scale > 1 ? ` @${t.scale}x` : '') + (t.id.endsWith('-guides') ? ' guides' : '');
    b.title = `${t.id}, recorded ${new Date(t.recorded).toLocaleString()}`;
    b.onclick = () => selectTake(t.id);
    b.dataset.id = t.id;
    takes.append(b);
  }
  const preferred = p.takes.find((t) => t.format === '16x9' && t.scale === 1 && !t.id.endsWith('-guides')) ?? p.takes[0];
  await selectTake(preferred.id);
}

export async function selectTake(id) {
  if (state.take && state.res) state.anchored = anchorEdits(state.take, stripIds(state.res));
  const take = state.project.takes.find((t) => t.id === id);
  state.take = take;
  state.res = withIds(resolveEdits(take, state.anchored));
  state.selected = null;
  for (const b of $('takes').children) b.classList.toggle('on', b.dataset.id === id);

  const banner = $('banner');
  banner.style.display = take.stale ? 'block' : 'none';
  banner.textContent = take.stale ? `This take is out of date: ${take.stale}. Edits may land on the wrong steps.` : '';

  $('frame').style.aspectRatio = `${take.width} / ${take.height}`;
  fitFrame();
  setStatus('Loading video…');
  video.src = `/media/${encodeURIComponent(id)}?v=${encodeURIComponent(take.recorded)}`;
  await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  setStatus('');
  $('tDur').textContent = take.duration.toFixed(2);
  // Fit the whole take in the timeline to start with.
  state.pps = Math.max(10, Math.min(300, (scroller.clientWidth - 40) / take.duration));
  $('zoom').value = state.pps;
  render();
  loadWave(id);
}

export async function loadWave(id) {
  if (!state.wave.has(id)) {
    const r = await fetch(`/api/waveform/${encodeURIComponent(id)}`);
    state.wave.set(id, await r.json());
  }
  if (state.take?.id === id) drawWave();
}
