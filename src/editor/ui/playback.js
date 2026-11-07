// Playing the take with the edits applied, the playhead and the preview overlay.

import { $, clamp } from './util.js';
import { scroller, state, video, x } from './state.js';

export function seek(t) {
  video.currentTime = clamp(t, 0, state.take.duration);
  updatePlayhead();
}

export function updatePlayhead() {
  const t = video.currentTime;
  const ph = $('playhead');
  if (ph) ph.style.left = x(t) + 'px';
  $('tNow').textContent = t.toFixed(2);
  renderOverlay(t);
}

// The preview loop applies edits while playing: it jumps over cuts and
// trimmed ends and plays speed-ups fast, so playback matches the render.
export function tick() {
  requestAnimationFrame(tick);
  if (!state.take) return;
  const t = video.currentTime;
  if (!video.paused && $('previewEdits').checked) {
    const { start, end } = state.res.trim;
    const cut = state.res.regions.find((r) => r.type === 'cut' && t >= r.from && t < r.to - 0.02);
    if (t < start - 0.02) video.currentTime = start;
    else if (t >= end) {
      video.pause();
      video.currentTime = end;
    } else if (cut) {
      video.currentTime = cut.to;
      $('cutFlash').style.opacity = 1;
      setTimeout(() => { $('cutFlash').style.opacity = 0; }, 180);
    }
    const sp = state.res.regions.filter((r) => r.type === 'speed' && t >= r.from && t < r.to).reduce((m, r) => Math.max(m, r.factor), 1);
    if (video.playbackRate !== sp) video.playbackRate = sp;
  } else if (video.playbackRate !== 1) {
    video.playbackRate = 1;
  }
  updatePlayhead();
  // Keep the playhead in view while playing.
  if (!video.paused) {
    const px = x(t);
    if (px < scroller.scrollLeft + 40 || px > scroller.scrollLeft + scroller.clientWidth - 80) scroller.scrollLeft = px - 80;
  }
}

export function renderOverlay(t) {
  const ov = $('overlay');
  if (!state.res || !$('previewEdits').checked) {
    ov.innerHTML = '';
    return;
  }
  const take = state.take;
  const active = state.res.regions.filter((r) => r.type === 'text' && r.text && t >= r.from && t < r.to);
  const key = active.map((r) => r.id + r.text + r.position).join('|') + ov.clientHeight;
  if (ov.dataset.key === key) return;
  ov.dataset.key = key;
  ov.innerHTML = '';
  // Same placement as the renderer: font 4.5% of the short side, inside
  // the safe area.
  const k = ov.clientHeight / take.height;
  const safe = take.safe ?? { top: 40, bottom: 40, left: 40, right: 40 };
  const fs = Math.min(take.width, take.height) * 0.045 * k;
  for (const r of active) {
    const d = document.createElement('div');
    d.className = 't';
    d.style.paddingLeft = safe.left * k + 'px';
    d.style.paddingRight = safe.right * k + 'px';
    if (r.position === 'top') d.style.top = (safe.top + 24) * k + 'px';
    else if (r.position === 'center') Object.assign(d.style, { top: '50%', transform: 'translateY(-50%)' });
    else d.style.bottom = (safe.bottom + 24) * k + 'px';
    const s = document.createElement('span');
    s.textContent = r.text;
    Object.assign(s.style, { fontSize: fs + 'px', padding: `${fs * 0.5}px` });
    d.append(s);
    ov.append(d);
  }
}

export function fitFrame() {
  const v = $('viewer');
  const take = state.take;
  if (!take) return;
  const k = Math.min(v.clientWidth / take.width, v.clientHeight / take.height);
  $('frame').style.width = take.width * k + 'px';
  $('frame').style.height = take.height * k + 'px';
  $('overlay').dataset.key = '';
}
