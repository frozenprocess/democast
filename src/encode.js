// Encoding: turns a take (raw recording + step timings + narration) and the
// scene's edits into the final MP4, contact sheet and subtitles. Re-run on
// its own (democast render, or the editor's Render button) after changing
// edits; nothing is re-recorded. The ffmpeg arguments are built in
// filters.js, the take's files in take.js.

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEdits, segments, outputDuration, mapRange } from './edits.js';
import { srt } from './tts.js';
import { ffmpeg } from './ffmpeg.js';
import { tempPath, release } from './cleanup.js';
import { takePaths, readTake, saveTake } from './take.js';
import { renderArgs, placeClips, mixClips } from './filters.js';

// finishTake turns a finished recording or remix into its outputs: it saves
// the take (see saveTake) and renders the MP4 with the edits. It returns
// what renderTake returns.
/** @param {Parameters<typeof saveTake>[0] & { sceneDir: string, edits: any }} options */
export function finishTake({ sceneDir, edits, ...rest }) {
  const file = saveTake(rest);
  return renderTake({ take: readTake(file), scene: rest.scene, sceneDir, edits });
}

// renderTake writes <base>.mp4, its contact sheet and, with narration, an
// .srt, applying edits (stored, anchored form; see edits.js).
export async function renderTake({ take, scene, sceneDir, edits }) {
  const p = takePaths(take.base);
  const res = resolveEdits(take, edits);
  const segs = segments(take, res);
  if (!segs.length) throw new Error('the edits cut everything; nothing left to render');
  const dur = outputDuration(segs);
  const narration = take.narration ?? [];
  let tmpDir;
  let font;
  if (res.regions.some((r) => r.type === 'text' && r.text)) {
    font = fontFile();
    tmpDir = tempPath(mkdtempSync(path.join(os.tmpdir(), 'democast-')));
  }
  const { args, texts } = renderArgs({ take, scene, sceneDir, res, segs, textDir: tmpDir, font });
  try {
    for (const { file, text } of texts) writeFileSync(file, text);
    await ffmpeg(args);
  } finally {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      release(tmpDir);
    }
  }

  await contactSheet(p.mp4, p.sheet, dur, take.format);
  let subtitles;
  const cues = narration.map((n) => {
    const r = mapRange(segs, n.start, n.start + n.duration);
    return r && { text: n.text, start: r.from, duration: r.to - r.from };
  }).filter(Boolean);
  if (cues.length) {
    writeFileSync(p.srt, srt(cues));
    subtitles = p.srt;
  } else {
    rmSync(p.srt, { force: true });
  }
  return { mp4: p.mp4, sheet: p.sheet, subtitles, duration: dur };
}

// previewTake writes <base>.take.mp4: the raw take with its narration and
// no edits, for the editor to play. It's rebuilt when the take changes.
export async function previewTake(take) {
  const p = takePaths(take.base);
  if (existsSync(p.preview) && statSync(p.preview).mtimeMs >= statSync(p.raw).mtimeMs) return p.preview;
  const args = ['-v', 'error', '-y', '-i', p.raw];
  const narration = take.narration ?? [];
  if (narration.length) {
    let next = 0;
    const clips = placeClips(narration, 1, (prefix) => `${prefix}${next++}`);
    args.push(...clips.args, '-filter_complex', `${clips.filters.join(';')};${mixClips(clips.labels, take)}[a]`,
      '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-map', '0:v', '-an');
  }
  args.push('-c:v', 'copy', '-movflags', '+faststart', p.preview);
  await ffmpeg(args);
  return p.preview;
}

// waveform returns narration loudness peaks, one per 1/rate seconds, from
// 0 to 1, for drawing in the editor.
export async function waveform(take, rate = 50) {
  const file = await previewTake(take);
  if (!(take.narration ?? []).length) return [];
  const { stdout: out } = await ffmpeg(['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate * 20),
    '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 1 << 28 });
  const stdout = /** @type {Buffer} */ (/** @type {unknown} */ (out));
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const peaks = [];
  for (let k = 0; k < samples.length; k += 20) {
    let m = 0;
    for (let j = k; j < k + 20 && j < samples.length; j++) m = Math.max(m, Math.abs(samples[j]));
    peaks.push(Math.round((m / 32768) * 100) / 100);
  }
  return peaks;
}

let font;
function fontFile() {
  if (font) return font;
  try {
    font = execFileSync('fc-match', ['-f', '%{file}', 'sans-serif:bold'], { encoding: 'utf8' }).trim();
  } catch {
    font = '';
  }
  if (!font || !existsSync(font)) throw new Error('text overlays need a font; install fontconfig (fc-match) and a sans-serif font');
  return font;
}

// contactSheet writes one PNG with 12 evenly spaced frames, for a quick
// look at a take without watching it.
export async function contactSheet(mp4, png, duration, format) {
  const layout = { '16x9': ['4x3', 480], '9x16': ['6x2', 300], '4x5': ['6x2', 320] }[format] ?? ['4x3', 400];
  const vf = `fps=12/${duration.toFixed(2)},scale=${layout[1]}:-1,tile=${layout[0]}:padding=6:color=black`;
  await ffmpeg(['-v', 'error', '-y', '-i', mp4, '-vf', vf, '-frames:v', '1', png]);
}
