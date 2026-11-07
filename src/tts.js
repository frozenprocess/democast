// Narration: synthesizes every say step's text before recording, so the
// runner knows how long each clip is and can pace the video to it.
//
// Engines:
//   kokoro     Kokoro-82M on ONNX Runtime; small, CPU-only (tts/kokoro_engine.py)
//   vibevoice  Microsoft VibeVoice-Realtime-0.5B; GPU recommended (tts/vibevoice_engine.py)
//   command    any program that reads text on stdin and writes a WAV to {out}
//
// The Python engines run with "uv run --script", which installs their
// dependencies into a cached environment on first use.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duration } from './ffmpeg.js';

const TTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tts');
export const ENGINES = ['kokoro', 'vibevoice', 'command'];

// voiceFor merges the scene's voice settings with a step's overrides.
function voiceFor(scene, step) {
  const v = { engine: 'kokoro', ...scene.voice, ...(typeof step === 'object' ? step.voice : null) };
  if (!ENGINES.includes(v.engine)) throw new Error(`unknown voice engine ${JSON.stringify(v.engine)}; want one of ${ENGINES.join(', ')}`);
  if (v.engine === 'command' && !v.command) throw new Error('voice engine "command" needs a "command"');
  return v;
}

// respell applies the scene's pronunciation map, e.g. { tailground: "Tail ground" },
// to the spoken text only. Whole words, case-sensitive.
export function respell(text, pronounce = {}) {
  for (const [word, say] of Object.entries(pronounce)) {
    const re = new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
    text = text.replace(re, say);
  }
  return text;
}

export function sayText(arg) {
  return typeof arg === 'string' ? arg : arg.text;
}

// prepareNarration synthesizes the clips for all say steps, reusing cached
// clips whose text and voice settings haven't changed. It returns a Map from
// each say step object to {file, duration}.
export async function prepareNarration({ scene, sceneDir, outDir, log }) {
  const says = scene.steps.filter((s) => 'say' in s);
  const clips = new Map();
  if (!says.length) return clips;

  const cacheDir = path.join(outDir, '.cache', 'tts');
  mkdirSync(cacheDir, { recursive: true });

  // Group missing clips by voice settings, so each engine process loads
  // its model once.
  const batches = new Map();
  for (const step of says) {
    const text = sayText(step.say);
    if (!text || /\{\{/.test(text)) throw new Error(`say: text must be non-empty and can't use {{variables}} (it's synthesized before recording): ${JSON.stringify(text)}`);
    const { pronounce, volume, ...voice } = voiceFor(scene, step.say);
    const spoken = respell(text, pronounce);
    const key = JSON.stringify(voice);
    const hash = createHash('sha256').update(key + '\0' + spoken).digest('hex').slice(0, 16);
    const file = path.join(cacheDir, `${voice.engine}-${hash}.wav`);
    clips.set(step, { file, text });
    if (!existsSync(file)) {
      if (!batches.has(key)) batches.set(key, { voice, items: [] });
      batches.get(key).items.push({ text: spoken, out: file });
    }
  }

  for (const { voice, items } of batches.values()) {
    log(`  synthesizing ${items.length} clip(s) with ${voice.engine}${voice.voice ? ` (${voice.voice})` : ''}`);
    // Write to temporary names, so an interrupted run never leaves a
    // partial clip in the cache.
    const tmpItems = items.map((it) => ({ text: it.text, out: it.out.replace(/\.wav$/, '.tmp.wav') }));
    if (voice.engine === 'command') {
      for (const it of tmpItems) await runCommand(voice.command, it, sceneDir);
    } else {
      await runEngine(voice, tmpItems, cacheDir);
    }
    items.forEach((it, i) => renameSync(tmpItems[i].out, it.out));
  }

  for (const clip of clips.values()) clip.duration = await duration(clip.file);
  return clips;
}

async function runEngine(voice, items, cacheDir) {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('the kokoro and vibevoice engines need uv (https://docs.astral.sh/uv/); install it or use engine "command"');
  }
  const { engine, ...settings } = voice;
  const jobs = path.join(cacheDir, `jobs-${process.pid}.json`);
  writeFileSync(jobs, JSON.stringify({ ...settings, items }));
  await run('uv', ['run', '--quiet', '--script', path.join(TTS_DIR, `${engine}_engine.py`), jobs], {});
}

// runCommand runs a user-supplied TTS command with the text on stdin;
// {out} in the command is replaced by the output WAV path.
async function runCommand(command, item, cwd) {
  const cmd = command.replaceAll('{out}', `'${item.out.replaceAll("'", "'\\''")}'`);
  await run('sh', ['-c', cmd], { cwd, stdin: item.text });
  if (!existsSync(item.out)) throw new Error(`voice command didn't write {out}: ${command}`);
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?: string, stdin?: string }} options
 */
function run(file, args, { cwd, stdin }) {
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, { cwd, stdio: [stdin != null ? 'pipe' : 'ignore', 'inherit', 'pipe'] });
    let stderr = '';
    p.stderr?.setEncoding('utf8').on('data', (d) => {
      stderr += d;
      process.stderr.write(d.replace(/^(?=.)/gm, '    '));
    });
    if (stdin != null) p.stdin?.end(stdin);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`${file} ${args.join(' ')}: exit status ${code}\n${stderr.slice(-1500)}`))));
  });
}

// srt renders narration timings as SubRip subtitles.
export function srt(narration) {
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return narration.map((n, i) => `${i + 1}\n${ts(n.start)} --> ${ts(n.start + n.duration)}\n${n.text}\n`).join('\n');
}
