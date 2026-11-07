// democast check: what can be known about a scene without running it. It
// finds the problems that would otherwise stop a recording partway (a
// missing image, an unset environment variable, a variable used before
// it's captured) and summarizes what the scene will record.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { isFormat, stageConfig } from './formats.js';
import { actionOf, panelsFor } from './scene.js';
import { buildRemix } from './remix.js';
import { profileName, profileDir } from './browser.js';
import { sayText } from './tts.js';

const VAR = /\{\{\s*([\w.]+)\s*\}\}/g;

// strings lists every string in v with where it is.
function strings(v, where, out = []) {
  if (typeof v === 'string') out.push([where, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${where}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${where}.${k}`, out);
  return out;
}

// captures returns the name of the variable a step saves, if any.
function captures(action, arg) {
  if (action === 'browser.capture' || action === 'term.waitFor') return arg?.var;
  if (action === 'term.run') return arg?.capture?.var;
  return undefined;
}

// checkScene returns { problems, summary }: lists of lines. formats
// defaults to the scene's.
/**
 * @param {import('./types.js').Scene} scene
 * @param {string} sceneDir
 * @param {{ formats?: string[] | null, env?: NodeJS.ProcessEnv }} [options]
 */
export function checkScene(scene, sceneDir, { formats, env = process.env } = {}) {
  const fmts = formats ?? scene.formats ?? ['16x9'];
  const steps = [
    ...(scene.setup ?? []).map((s, i) => [`setup[${i}]`, s]),
    ...scene.steps.map((s, i) => [`steps[${i}]`, s]),
    ...(scene.teardown ?? []).map((s, i) => [`teardown[${i}]`, s]),
  ];

  const profile = profileName(scene);
  const problems = [
    ...checkVariables(scene, steps, env),
    ...checkFiles(scene, sceneDir, steps, profile),
    ...checkLayouts(scene, sceneDir, fmts),
  ];
  return { problems, summary: summarizeScene(scene, fmts, profile) };
}

// Check references in execution order, including off-camera steps.
function checkVariables(scene, steps, env) {
  const problems = [];
  // Variables: {{env.X}} must be set; {{name}} must be captured by an
  // earlier step. say lines are synthesized before anything runs, so they
  // can't use variables at all.
  const known = new Set();
  const ids = new Set();
  const unset = new Map(); // env name -> where it's used
  const needEnv = (name, at) => {
    if (env[name] === undefined) unset.set(name, [...new Set([...(unset.get(name) ?? []), at])]);
  };
  for (const [where, step] of steps) {
    const action = actionOf(step);
    const arg = step[action];
    for (const [at, s] of strings(arg, `${where}.${action}`)) {
      for (const [, name] of s.matchAll(VAR)) {
        if (action === 'say') problems.push(`${at}: say lines can't use variables ({{${name}}}); they're synthesized before the scene runs`);
        else if (name.startsWith('env.')) needEnv(name.slice(4), at);
        else if (!known.has(name.split('.')[0])) problems.push(`${at}: {{${name}}} is used before any step captures it`);
      }
    }
    const v = captures(action, arg);
    if (v) known.add(v);
    if (action === 'term.run' && arg?.id) ids.add(arg.id);
    const id = action === 'term.waitFor' ? arg?.id : ['term.wait', 'term.kill'].includes(action) ? arg : null;
    if (id != null && !ids.has(id) && !/^proc\d+$/.test(id)) problems.push(`${where}.${action}: no earlier term.run has id ${JSON.stringify(id)}`);
  }
  for (const [at, s] of [...strings(scene.browser, 'browser'), ...strings(scene.redact, 'redact'), ...strings(scene.site, 'site'), ...strings(scene.env, 'env')]) {
    for (const [, name] of s.matchAll(VAR)) {
      if (!name.startsWith('env.')) problems.push(`${at}: only {{env.*}} can be used here ({{${name}}})`);
      else needEnv(name.slice(4), at);
    }
  }
  for (const [name, uses] of unset) {
    problems.push(`$${name} is not set (used in ${uses.slice(0, 3).join(', ')}${uses.length > 3 ? ` and ${uses.length - 3} more` : ''})`);
  }

  return problems;
}

function checkFiles(scene, sceneDir, steps, profile) {
  const problems = [];
  // Files the scene points at.
  const local = (f) => typeof f === 'string' && !/^[a-z]+:/.test(f) && !f.includes('{{');
  for (const [where, step] of steps) {
    const img = step.card?.image;
    if (local(img) && !existsSync(path.resolve(sceneDir, img))) problems.push(`${where}.card.image: no file ${img}`);
  }
  const music = typeof scene.music === 'string' ? scene.music : scene.music?.file;
  if (local(music) && !existsSync(path.resolve(sceneDir, music))) problems.push(`music: no file ${music}`);
  if (profile && !existsSync(profileDir(profile))) problems.push(`browser.profile: no saved profile "${profile}"; run "democast login" first`);

  return problems;
}

function checkLayouts(scene, sceneDir, fmts) {
  const problems = [];
  // Layouts, in each format.
  for (const f of fmts) {
    if (!isFormat(f)) {
      problems.push(`formats: unknown format ${f}`);
      continue;
    }
    try {
      if (scene.remix) {
        buildRemix({ scene, sceneDir, format: f, clips: new Map() });
        continue;
      }
      const cfg = stageConfig(f, scene, panelsFor(scene));
      if (scene.steps.some((s) => actionOf(s) === 'view') && !cfg.views) {
        problems.push(`${f}: view steps need a side-by-side layout with a browser and one terminal (not 9x16, not pane: 2)`);
      }
    } catch (err) {
      problems.push(`${f}: ${err.message}`);
    }
  }

  return problems;
}

function summarizeScene(scene, fmts, profile) {
  const says = scene.steps.filter((s) => 'say' in s);
  const shown = scene.remix
    ? [...new Set(scene.steps.filter((s) => 'clip' in s).map((s) => s.clip.window ?? 'browser'))]
    : Object.entries(panelsFor(scene)).filter(([, on]) => on).map(([k]) => k);
  const summary = [
    `scene ${scene.name}${scene.remix ? ' (remix)' : ''}: ${scene.steps.length} step(s)${scene.setup?.length ? `, ${scene.setup.length} setup` : ''}${scene.teardown?.length ? `, ${scene.teardown.length} teardown` : ''}`,
    `panels: ${shown.join(', ') || 'none'}`,
    `formats: ${fmts.join(', ')}`,
    says.length
      ? `narration: ${says.length} line(s), ${scene.voice?.engine ?? 'kokoro'}${scene.voice?.voice ? ` (${scene.voice.voice})` : ''}, ${says.reduce((n, s) => n + sayText(s.say).split(/\s+/).length, 0)} words`
      : 'narration: none',
  ];
  if (profile) summary.push(`browser profile: ${profile}`);
  return summary;
}
