// Loading and saving a scene and its edits.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { actionOf, ACTION_NAMES, REMIX_ACTIONS } from './scene.js';
import { emptyEdits, checkEdits } from './edits.js';
import { readTake } from './take.js';
import { checkRedact } from './redact.js';
import { validate } from './schema.js';

// loadScene reads and checks a scene file. It throws with a message fit
// for the user.
/** @returns {import('./types.js').Scene} */
export function loadScene(scenePath) {
  let scene;
  try {
    scene = YAML.parse(readFileSync(scenePath, 'utf8'));
  } catch (err) {
    throw new Error(`reading ${scenePath}: ${err.message}`);
  }
  if (!scene || typeof scene !== 'object') throw new Error('scene must be a YAML mapping');
  if (!Array.isArray(scene.steps) || !scene.steps.length) throw new Error('scene needs a non-empty "steps" list');
  // A remix (remix.js) cuts clips from recorded takes: no site, no commands.
  checkSteps(scene.steps, 'step', scene.remix ? REMIX_ACTIONS : ACTION_NAMES);
  if (scene.remix && (scene.setup || scene.teardown || scene.site)) throw new Error('a remix scene has no "setup", "teardown" or "site": it only cuts clips from recorded takes');
  for (const part of ['setup', 'teardown']) {
    if (scene[part] == null) continue;
    if (!Array.isArray(scene[part])) throw new Error(`"${part}" must be a list of steps`);
    checkSteps(scene[part], `${part} step`, ACTION_NAMES);
  }
  // Everything else: settings and each action's arguments
  // (schema/scene.schema.json).
  validate(scene);
  if (scene.redact != null) checkRedact(scene.redact);
  scene.name ??= path.basename(scenePath).replace(/\.ya?ml$/, '');
  return scene;
}

function checkSteps(steps, what, names) {
  steps.forEach((s, i) => {
    const keys = s && typeof s === 'object' ? Object.keys(s).filter((k) => k !== 'timeout') : [];
    if (keys.length !== 1) throw new Error(`${what} ${i}: want exactly one action per step, got ${JSON.stringify(s)}`);
    if (!names.includes(keys[0])) throw new Error(`${what} ${i}: unknown action ${JSON.stringify(keys[0])}; known: ${names.join(', ')}`);
  });
}

// Edits live next to the scene: tailground.yaml -> tailground.edits.yaml.
export function editsPath(scenePath) {
  return scenePath.replace(/\.ya?ml$/, '') + '.edits.yaml';
}

export function loadEdits(scenePath) {
  const file = editsPath(scenePath);
  if (!existsSync(file)) return emptyEdits();
  let edits;
  try {
    edits = checkEdits(YAML.parse(readFileSync(file, 'utf8')) ?? {});
  } catch (err) {
    throw new Error(`${path.relative('.', file)}: ${err.message}`);
  }
  return { ...emptyEdits(), ...edits };
}

export function saveEdits(scenePath, edits) {
  const header = '# Timeline edits for this scene, made with "democast edit".\n' +
    '# Times are anchored to steps (index into the scene\'s steps, and seconds\n' +
    '# into that step), so they apply to every format and survive re-recording.\n';
  writeFileSync(editsPath(scenePath), header + YAML.stringify(edits));
}

// findTakes lists the recorded takes of a scene in outDir, newest format
// files first; with formats, only those.
/**
 * @param {string} outDir
 * @param {import('./types.js').Scene} scene
 * @param {string[] | null} [formats]
 * @returns {import('./types.js').Take[]}
 */
export function findTakes(outDir, scene, formats) {
  if (!existsSync(outDir)) return [];
  const prefix = `${scene.name}-`;
  return readdirSync(outDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.take.json'))
    .map((f) => readTake(path.join(outDir, f)))
    // The prefix alone would also match the takes of "demo-v2" for "demo".
    .filter((t) => t.scene === scene.name)
    .filter((t) => !formats || formats.includes(t.format))
    .sort((a, b) => a.base.localeCompare(b.base));
}

// staleness reports how a take's steps differ from the scene's current
// steps, or null if they match. Edits are anchored to step indices, so a
// take recorded before steps were added or removed won't line up.
/**
 * @param {import('./types.js').Take} take
 * @param {import('./types.js').Scene} scene
 */
export function staleness(take, scene) {
  const now = scene.steps.map(actionOf);
  const then = take.steps.map((s) => s.action);
  if (now.length !== then.length || now.some((a, i) => a !== then[i])) {
    return `the scene's steps changed since this take was recorded (${then.length} steps then, ${now.length} now); re-record it`;
  }
  return null;
}
