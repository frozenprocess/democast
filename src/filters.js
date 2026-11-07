// The ffmpeg arguments that render a take: pure functions of the take, the
// scene and the edits, so they can be tested without running ffmpeg.

import path from 'node:path';
import { outputDuration, mapRange } from './edits.js';
import { takePaths, FPS } from './take.js';

// x264 quality (lower is better) of the final video.
const FINAL_CRF = 20;

// renderArgs builds the ffmpeg arguments that render a take with resolved
// edits (res) cut into segs. It touches no files, so it can be tested: text
// overlays are read from files in textDir (drawtext's textfile, which
// needs no escaping), and it returns them as texts, [{file, text}], for
// the caller to write. font is the overlays' font file.
/**
 * @param {{ take: import('./types.js').Take, scene: import('./types.js').Scene, sceneDir: string, res: any, segs: any[], textDir?: string, font?: string }} options
 */
export function renderArgs({ take, scene, sceneDir, res, segs, textDir, font }) {
  const p = takePaths(take.base);
  const dur = outputDuration(segs);
  const t = dur.toFixed(3);
  let nextLabel = 0;
  const label = (prefix) => `${prefix}${nextLabel++}`;
  const video = videoFilters({ take, res, segs, textDir, font }, label);
  const voice = narrationFilters({ take, scene, res, segs }, label);
  const music = musicFilters({ scene, sceneDir, res, dur, input: 1 + voice.inputCount });
  const haveVoice = voice.inputCount > 0;
  const haveMusic = music.args.length > 0;
  const haveAudio = haveVoice || haveMusic;
  const args = ['-v', 'error', '-y', '-i', p.raw, ...voice.args, ...music.args];
  const filters = [
    ...video.filters, ...voice.filters, ...music.filters,
    ...mixFilters(haveVoice, haveMusic, dur),
  ];

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  // Above 1080p, a faster preset keeps encode times reasonable.
  const preset = take.scale > 1 ? 'medium' : 'slow';
  args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(FINAL_CRF), '-pix_fmt', 'yuv420p', '-r', String(take.fps ?? FPS));
  if (haveAudio) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  args.push('-t', t, '-movflags', '+faststart', p.mp4);
  return { args, texts: video.texts };
}

function videoFilters({ take, res, segs, textDir, font }, label) {
  const filters = [];
  // Video: keep each segment at its speed, then add text overlays.
  const vparts = [];
  filters.push(`[0:v]split=${segs.length}${segs.map((_, k) => `[vs${k}]`).join('')}`);
  segs.forEach((s, k) => {
    const l = label('v');
    filters.push(`[vs${k}]trim=start=${s.a.toFixed(3)}:end=${s.b.toFixed(3)},setpts=(PTS-STARTPTS)/${s.speed}[${l}]`);
    vparts.push(`[${l}]`);
  });
  filters.push(`${vparts.join('')}concat=n=${vparts.length}:v=1:a=0[vcat]`);
  const texts = [];
  const overlays = res.regions.filter((r) => r.type === 'text' && r.text);
  if (overlays.length) {
    const chain = overlays.map((r, k) => {
      const range = mapRange(segs, r.from, r.to);
      if (!range) return null;
      const file = path.join(textDir, `text${k}.txt`);
      texts.push({ file, text: r.text });
      return drawtext(take, { file, font, position: r.position ?? 'bottom', from: range.from, to: range.to });
    }).filter(Boolean);
    filters.push(`[vcat]${chain.length ? chain.join(',') : 'null'}[vout]`);
  } else {
    filters.push('[vcat]null[vout]');
  }

  return { filters, texts };
}

// placeClips has the inputs and filters that put each narration clip where
// it was said on the take's timeline: stereo, 48 kHz, delayed. The clips
// are inputs firstInput and up; labels are the filters' outputs.
export function placeClips(narration, firstInput, label) {
  const args = [];
  const filters = [];
  const labels = narration.map((n, k) => {
    // Only plain files: a clip that is really a playlist can't pull in others.
    args.push('-protocol_whitelist', 'file', '-i', n.file);
    const l = label('n');
    filters.push(`[${firstInput + k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(n.start * 1000)}:all=1[${l}]`);
    return `[${l}]`;
  });
  return { args, filters, labels };
}

// mixClips is the filter text that mixes placed clips into one track as
// long as the take (volume, when given, scales it). More filters can follow.
export function mixClips(labels, take, volume) {
  return `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,` +
    `${volume === undefined ? '' : `volume=${volume},`}apad,atrim=end=${take.duration.toFixed(3)}`;
}

function narrationFilters({ take, scene, res, segs }, label) {
  // Voice: narration placed on the take's timeline, then cut and sped up
  // along with the video.
  const narration = take.narration ?? [];
  const voiceVol = (scene.voice?.volume ?? 1) * (res.audio.voice ?? 1);
  if (!(narration.length && voiceVol > 0)) return { args: [], filters: [], inputCount: 0 };
  const { args, filters, labels } = placeClips(narration, 1, label);
  filters.push(`${mixClips(labels, take, voiceVol)},asplit=${segs.length}${segs.map((_, k) => `[as${k}]`).join('')}`);
  const aparts = segs.map((s, k) => {
    const l = label('a');
    filters.push(`[as${k}]atrim=start=${s.a.toFixed(3)}:end=${s.b.toFixed(3)},asetpts=PTS-STARTPTS${atempo(s.speed)}[${l}]`);
    return `[${l}]`;
  });
  filters.push(`${aparts.join('')}concat=n=${aparts.length}:v=0:a=1[voice]`);
  return { args, filters, inputCount: narration.length };
}

function musicFilters({ scene, sceneDir, res, dur, input }) {
  const t = dur.toFixed(3);
  // Music: on the output timeline, faded, and ducked under the voice.
  if (!(scene.music && (res.audio.music ?? 1) > 0)) return { args: [], filters: [] };
  const args = [];
  const filters = [];
  const m = typeof scene.music === 'string' ? { file: scene.music } : scene.music;
  args.push('-stream_loop', '-1', '-i', path.resolve(sceneDir, m.file));
  const fade = Math.max(0, dur - 2).toFixed(2);
  filters.push(`[${input}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${(m.volume ?? 0.6) * (res.audio.music ?? 1)},` +
    `atrim=end=${t},afade=t=in:d=1,afade=t=out:st=${fade}:d=2[music]`);
  return { args, filters };
}

function mixFilters(haveVoice, haveMusic, duration) {
  const filters = [];
  const t = duration.toFixed(3);
  if (haveVoice && haveMusic) {
    filters.push('[voice]asplit[v1][v2]');
    filters.push('[music][v2]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]');
    filters.push('[ducked][v1]amix=inputs=2:normalize=0:duration=first[mix]');
  } else if (haveVoice) {
    filters.push('[voice]anull[mix]');
  } else if (haveMusic) {
    filters.push('[music]anull[mix]');
  }
  const haveAudio = haveVoice || haveMusic;
  if (haveAudio) filters.push(`[mix]apad,atrim=end=${t},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

  return filters;
}

export function atempo(speed) {
  if (speed === 1) return '';
  const parts = [];
  let f = speed;
  while (f > 2) {
    parts.push('atempo=2');
    f /= 2;
  }
  parts.push(`atempo=${f}`);
  return ',' + parts.join(',');
}

// drawtext renders a text overlay: white on a dark box, centered, inside the
// format's safe area when it has one.
function drawtext(take, { file, font, position, from, to }) {
  const s = take.scale ?? 1;
  const safe = take.safe ?? { top: 40, bottom: 40, left: 40, right: 40 };
  const fontsize = Math.round(Math.min(take.width, take.height) * 0.045 * s);
  const top = Math.round((safe.top + 24) * s);
  const bottom = Math.round((safe.bottom + 24) * s);
  const left = Math.round(safe.left * s);
  const right = Math.round(safe.right * s);
  const y = { top: `${top}`, center: '(h-th)/2', bottom: `h-th-${bottom}` }[position] ?? `h-th-${bottom}`;
  const esc = (v) => v.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  return [
    `drawtext=fontfile='${esc(font)}':textfile='${esc(file)}':fontsize=${fontsize}:fontcolor=white`,
    `box=1:boxcolor=black@0.7:boxborderw=${Math.round(fontsize * 0.5)}`,
    `x=${left}+(w-${left}-${right}-tw)/2:y=${y}`,
    `enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`,
  ].join(':');
}
