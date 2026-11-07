// Takes: a recording's files and the take file that describes it (timings,
// narration), kept next to the raw video so edits can be rendered again
// without recording.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { inside } from './util.js';

// FPS is the frame rate unless the scene sets fps or --fps is given.
export const FPS = 30;

// resolveFps is the frame rate for a scene: its own fps, else the default.
export function resolveFps(scene) {
  return scene.fps ?? FPS;
}

// outputBase is the path (without extension) of a scene's files for one
// format and scale, in outDir; suffix tells variants apart (-guides).
export function outputBase(outDir, scene, format, scale, suffix = '') {
  return path.join(outDir, `${scene.name}-${format}${scale === 1 ? '' : `@${scale}x`}${suffix}`);
}

export function takePaths(base) {
  return {
    take: base + '.take.json',
    raw: base + '.raw.mkv',
    preview: base + '.take.mp4',
    mp4: base + '.mp4',
    sheet: base + '-sheet.png',
    srt: base + '.srt',
    narration: base + '.narration',
  };
}

// keepNarration copies a take's narration clips into <base>.narration/
// and returns the narration with their paths relative to the take file,
// so the take still renders after the voice cache is cleared, or out/ is
// moved.
export function keepNarration(base, narration) {
  const dir = takePaths(base).narration;
  rmSync(dir, { recursive: true, force: true });
  if (!narration.length) return narration;
  mkdirSync(dir);
  return narration.map((n, i) => {
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}.wav`);
    copyFileSync(n.file, file);
    return { ...n, file: path.relative(path.dirname(base), file) };
  });
}

/**
 * @param {string} file
 * @returns {import('./types.js').Take}
 */
export function readTake(file) {
  const take = JSON.parse(readFileSync(file, 'utf8'));
  take.base = file.replace(/\.take\.json$/, '');
  // Clip paths are relative to the take file (absolute in older takes).
  for (const n of take.narration ?? []) n.file = inside(path.dirname(file), n.file, `${path.basename(file)}: narration clip`);
  return take;
}

// saveTake moves a finished recording's raw video (raw) to its place beside
// the take, and writes the take file: the timings and narration. extra adds
// fields (remix: true).
/**
 * @param {{ base: string, raw: string, scene: import('./types.js').Scene, format: string, scale: number, cfg: import('./types.js').StageConfig,
 *   fps: number, duration: number, steps: import('./types.js').TakeStep[], narration: import('./types.js').NarrationClip[], extra?: object }} options
 */
export function saveTake({ base, raw, scene, format, scale, cfg, fps, duration, steps, narration, extra = {} }) {
  const p = takePaths(base);
  renameSync(raw, p.raw);
  writeFileSync(p.take, JSON.stringify({
    version: 1,
    scene: scene.name,
    format,
    scale,
    width: cfg.w,
    height: cfg.h,
    safe: cfg.safe,
    fps,
    duration,
    recorded: new Date().toISOString(),
    ...extra,
    steps,
    narration: keepNarration(base, narration),
  }, null, 2));
  return p.take;
}
