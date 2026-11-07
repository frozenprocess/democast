// Sources: each window of a take on its own, full frame, frame for frame in
// sync with the take (like OBS's Source Record), rendered from the replay
// log a --sources or --sources-later take keeps in <take>.log/.
//
// Each source is a separate replay of the same log (renderStage with
// source set), so they're independent: renderSources runs them, across
// any number of logs, a few at a time.

import { startFfmpeg } from './ffmpeg.js';
import { noop } from './util.js';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderStage, readTakeLog, STAGE_URL } from './replay.js';
import { writeTerminalHtml } from './termhtml.js';

// The windows a take can have, and the name each source file gets.
const SOURCES = [['browser', 'browser'], ['term', 'terminal'], ['term2', 'terminal2']];

// defaultJobs: each render is one Chrome plus one ffmpeg, a few cores each.
export function defaultJobs() {
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)));
}

// sourceJobs lists the sources one kept log can render: { logDir, src,
// name, mp4 }. Without force, a source whose MP4 is newer than the log is
// left out.
export function sourceJobs(logDir, { force = false } = {}) {
  const meta = path.join(logDir, 'log.json');
  if (!existsSync(meta)) throw new Error(`${logDir}: no log.json (record with --sources or --sources-later)`);
  const cfg = JSON.parse(readFileSync(meta, 'utf8')).cfg;
  const base = logDir.replace(/\.log\/?$/, '');
  const logTime = statSync(meta).mtimeMs;
  return SOURCES.filter(([src]) => cfg[src])
    .map(([src, name]) => ({ logDir, src, name, mp4: `${base}-${name}.mp4` }))
    .filter((j) => force || !existsSync(j.mp4) || statSync(j.mp4).mtimeMs < logTime);
}

// renderSources renders every source of every log in logDirs, jobs at a
// time, and returns the files written, in order: each terminal's HTML page
// first (termhtml.js; quick, no Chrome), then the MP4s.
export async function renderSources(logDirs, { chrome, jobs = defaultJobs(), force = false, log = noop }) {
  const pages = logDirs.flatMap((d) => writeTerminalHtml(d, { force }));
  for (const f of pages) log(`  wrote ${path.basename(f)}`);
  const todo = logDirs.flatMap((d) => sourceJobs(d, { force }));
  const logs = new Map();
  const load = (dir) => {
    if (!logs.has(dir)) {
      logs.set(dir, readTakeLog(dir));
    }
    return logs.get(dir);
  };
  const written = new Array(todo.length);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const k = next++;
      const j = todo[k];
      const m = load(j.logDir);
      const label = path.basename(j.mp4);
      const t = Date.now();
      log(`  source: ${label}`);
      const raw = j.mp4.replace(/\.mp4$/, '.raw.mkv');
      try {
        await renderStage({
          chrome, stageUrl: STAGE_URL, cfg: m.cfg, scale: m.scale, log: m, source: j.src,
          t0: m.t0, duration: m.duration, fps: m.fps, file: raw,
        });
        await encodeSource(raw, j.mp4);
      } finally {
        rmSync(raw, { force: true });
      }
      log(`  wrote ${label} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
      written[k] = j.mp4;
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, worker));
  return [...pages, ...written];
}

// x264 quality (lower is better) for the source videos.
const SOURCE_CRF = 16;

// encodeSource turns a source render (near-lossless, large) into an MP4
// for the edit: H.264, high quality, the same frames as the take.
export function encodeSource(raw, mp4) {
  return startFfmpeg(['-loglevel', 'error', '-y', '-i', raw, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(SOURCE_CRF),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { label: 'source encode' }).done;
}
