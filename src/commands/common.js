// What the commands share: how they fail, and the scene they work on.

import path from 'node:path';
import { requireChrome } from '../browser.js';
import { hasFfmpeg } from '../ffmpeg.js';
import { loadScene, loadEdits } from '../project.js';
import { assertFormats } from '../formats.js';

// A CliError is a failure to report as "democast: <message>" and exit 1.
export class CliError extends Error {}

// fail throws a CliError.
export function fail(message) {
  throw new CliError(message);
}

// requireFfmpeg fails unless ffmpeg can be run.
export function requireFfmpeg() {
  if (!hasFfmpeg()) fail('ffmpeg not found in PATH');
}

// chromeFor is the Chrome to use (--chrome, $CHROME_PATH or autodetected);
// it fails when there is none.
export function chromeFor(flags) {
  try {
    return requireChrome(flags.chrome);
  } catch (err) {
    return fail(err.message);
  }
}

// openScene loads the scene a command works on, with its edits, the
// --format list and the output folder.
export function openScene(flags, positionals) {
  const scenePath = path.resolve(positionals[0]);
  let scene, edits;
  try {
    scene = loadScene(scenePath);
    edits = loadEdits(scenePath);
  } catch (err) {
    return fail(err.message);
  }
  if (flags['no-redact']) {
    delete scene.redact;
    if (scene.browser) delete scene.browser.blur;
    scene.noBlur = true;
  }
  const formats = flags.format ? flags.format.split(',').map((s) => s.trim()) : null;
  try {
    assertFormats(formats ?? []);
  } catch (err) {
    return fail(err.message);
  }
  return { scenePath, sceneDir: path.dirname(scenePath), scene, edits, formats, outDir: path.resolve(flags.out) };
}
