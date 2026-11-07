// Small helpers shared across modules.

import path from 'node:path';

// sleep resolves after ms milliseconds (negative counts as 0).
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// noop is the default for a callback (a logger, a progress report) the caller
// may leave out.
export const noop = /** @type {(...args: any[]) => void} */ (() => {});

// inside resolves file against dir and returns it, or throws if it ends up
// elsewhere (an absolute path, or ../). Take and log files name the media
// they use, and a folder of takes that came from someone else mustn't be
// able to point democast, or ffmpeg, at the rest of the disk.
export function inside(dir, file, what) {
  const base = path.resolve(dir);
  const full = path.resolve(base, String(file));
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`${what}: ${JSON.stringify(file)} is outside ${dir}`);
  return full;
}

// shortLabel cuts a step's label to fit the editor's timeline.
export function shortLabel(text, max = 60) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 2) + '…' : s;
}
