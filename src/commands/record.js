// democast [record]: record a scene (or cut a remix) in each format.

import path from 'node:path';
import { record as recordScene } from '../runner.js';
import { remix } from '../remix.js';
import { prepareNarration } from '../tts.js';
import { editsPath } from '../project.js';
import { chromeFor, fail } from './common.js';

// useVoice applies --voice engine[:voice] to the scene.
function useVoice(scene, spec) {
  const [engine, voice] = spec.split(':');
  // Keep engine-independent settings; drop the rest when switching engines.
  const { pronounce, volume } = scene.voice ?? {};
  const same = engine === scene.voice?.engine ? scene.voice : {};
  scene.voice = { ...same, pronounce, volume, engine, ...(voice ? { voice } : {}) };
}

// recordSettings checks --scale and --fps.
function recordSettings(flags) {
  const scale = flags['4k'] ? 2 : Number(flags.scale);
  if (!(scale > 0 && scale <= 4)) fail(`--scale must be a number between 0 and 4, got ${flags.scale}`);
  const fps = flags.fps ? Number(flags.fps) : undefined;
  if (fps !== undefined && !(Number.isInteger(fps) && fps >= 1 && fps <= 120)) fail(`--fps must be a whole number from 1 to 120, got ${flags.fps}`);
  return { scale, fps };
}

export async function record({ flags, jobs, scenePath, sceneDir, scene, edits, formats, outDir }) {
  if (flags.voice) useVoice(scene, flags.voice);

  const retries = Number(flags.retries);
  const log = flags.quiet ? () => {} : (m) => console.log(m);
  let clips;
  if (!flags['no-voice']) {
    try {
      clips = await prepareNarration({ scene, sceneDir, outDir, log: console.log });
    } catch (err) {
      fail(`narration: ${err.message}`);
    }
  }
  if (flags['voice-only']) {
    for (const c of clips?.values() ?? []) console.log(`${path.relative('.', c.file)}\t${c.duration.toFixed(2)}s\t${c.text}`);
    return 0;
  }

  const chrome = chromeFor(flags);
  const { scale, fps } = recordSettings(flags);

  // Both are checked already: --format by openScene, the scene's own list by
  // the schema when the scene loads.
  const recordFormats = formats ?? [].concat(scene.formats ?? '16x9');
  if (edits.regions.length || edits.trim.start || edits.trim.end) {
    console.log(`applying edits from ${path.relative('.', editsPath(scenePath))}`);
  }
  let failed = false;
  for (const format of recordFormats) {
    for (let attempt = 0; ; attempt++) {
      console.log(`${scene.name} ${format}${attempt ? ` (retry ${attempt})` : ''}`);
      try {
        const res = scene.remix
          ? await remix({ scene, sceneDir, format, outDir, chrome, clips, edits, scale, fps, log })
          : await recordScene({
            scene, sceneDir, format, outDir, chrome, headed: flags.headed, clips, edits, scale, fps, guides: flags.guides,
            smooth: flags.smooth || flags.sources || flags['sources-later'], sources: flags.sources,
            sourcesLater: flags['sources-later'], jobs, log,
          });
        console.log(`  wrote ${path.relative('.', res.mp4)} (${res.duration.toFixed(1)}s), contact sheet ${path.relative('.', res.sheet)}` +
          (res.subtitles ? `, subtitles ${path.relative('.', res.subtitles)}` : ''));
        for (const f of res.sources ?? []) console.log(`  wrote ${path.relative('.', f)}`);
        break;
      } catch (err) {
        console.error(`  failed: ${err.message}`);
        if (attempt >= retries) {
          failed = true;
          break;
        }
      }
    }
  }
  return failed ? 1 : 0;
}
