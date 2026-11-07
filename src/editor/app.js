// democast timeline editor. Plain JavaScript, no build step.
//
// Edits are kept in two forms (see edits.js): "res", in seconds on the
// current take's timeline, which the UI works with; and the anchored form
// that's saved, which carries edits across formats and re-recordings.
//
// This file wires the page's controls to the modules in ui/ and starts the
// editor; state.js holds what they share.

import { $, clamp, setStatus } from './ui/util.js';
import { scroller, state, video } from './ui/state.js';
import { load } from './ui/load.js';
import { addRegion, change, deleteSelected, redo, renderTakes, save, undo } from './ui/edit.js';
import { render } from './ui/render.js';
import { renderTimeline } from './ui/timeline.js';
import { fitFrame, seek, tick, updatePlayhead } from './ui/playback.js';

$('play').onclick = () => (video.paused ? video.play() : video.pause());
video.addEventListener('play', () => { $('play').textContent = '❚❚ Pause'; });
video.addEventListener('pause', () => { $('play').textContent = '▶ Play'; });
$('previewEdits').onchange = () => { $('overlay').dataset.key = ''; updatePlayhead(); };
$('undo').onclick = undo;
$('redo').onclick = redo;
$('save').onclick = () => save().catch((err) => setStatus(`Save failed: ${err.message}`, 'err'));
$('renderOne').onclick = () => renderTakes([state.take.id]);
$('renderAll').onclick = () => renderTakes(state.project.takes.map((t) => t.id));
for (const b of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-add]'))) b.onclick = () => addRegion(b.dataset.add);
$('trimIn').onclick = () => change((res) => { res.trim.start = Math.min(video.currentTime, res.trim.end - 0.2); });
$('trimOut').onclick = () => change((res) => { res.trim.end = Math.max(video.currentTime, res.trim.start + 0.2); });
$('trimReset').onclick = () => change((res) => { res.trim = { start: 0, end: state.take.duration }; });
$('zoom').oninput = (e) => {
  const center = (scroller.scrollLeft + scroller.clientWidth / 2) / state.pps;
  state.pps = Number(e.target.value);
  renderTimeline();
  updatePlayhead();
  scroller.scrollLeft = center * state.pps - scroller.clientWidth / 2;
};
for (const [id, key] of [['voiceVol', 'voice'], ['musicVol', 'music']]) {
  let first = true;
  $(id).oninput = (e) => {
    change((res) => { res.audio = { ...res.audio, [key]: Number(e.target.value) }; }, { record: first });
    first = false;
  };
  $(id).onchange = () => { first = true; };
}
scroller.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const z = $('zoom');
    z.value = clamp(Number(z.value) * (e.deltaY < 0 ? 1.15 : 1 / 1.15), Number(z.min), Number(z.max));
    z.oninput({ target: z });
  } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    scroller.scrollLeft += e.deltaY;
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!state.take) return;
  const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName ?? '') && active?.type !== 'range';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    $('save').onclick();
    return;
  }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod || e.altKey) return;
  switch (e.key) {
    case ' ': e.preventDefault(); $('play').onclick(); break;
    case 'ArrowLeft': e.preventDefault(); seek(video.currentTime - (e.shiftKey ? 1 : 1 / (state.take?.fps ?? 30))); break;
    case 'ArrowRight': e.preventDefault(); seek(video.currentTime + (e.shiftKey ? 1 : 1 / (state.take?.fps ?? 30))); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break;
    case 'c': addRegion('cut'); break;
    case 's': addRegion('speed'); break;
    case 't': e.preventDefault(); addRegion('text'); break;
    case 'i': $('trimIn').onclick(); break;
    case 'o': $('trimOut').onclick(); break;
    case 'Escape': state.selected = null; render(); break;
  }
});
window.addEventListener('resize', () => { fitFrame(); if (state.take) renderTimeline(), updatePlayhead(); });
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

requestAnimationFrame(tick);
load().catch((err) => setStatus(`Failed to load: ${err.message}`, 'err'));
