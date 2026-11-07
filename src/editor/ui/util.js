// Small helpers shared by the editor's modules.

// The page's elements are all in index.html, so one that's looked up is
// there; they're typed loosely (any) rather than cast at each use.
/** @type {(id: string) => any} */
export const $ = (id) => document.getElementById(id);

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${s.toFixed(0).padStart(2, '0')}` : `${s.toFixed(s % 1 ? 1 : 0)}s`;
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function setStatus(msg, cls = '') {
  const s = $('status');
  s.textContent = msg;
  s.className = cls;
  s.title = msg;
}
