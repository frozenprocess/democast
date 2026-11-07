// The commands, and what each needs before it runs: a scene to load
// (`scene`), ffmpeg on the PATH (`ffmpeg`). A command's run() gets
// { flags, positionals, jobs, ...the scene (see openScene) } and returns
// the exit status, or undefined to keep the process running (edit).

import { record } from './record.js';
import { render } from './render.js';
import { edit } from './edit.js';
import { check } from './check.js';
import { login } from './login.js';
import { sources } from './sources.js';

export const COMMANDS = {
  record: { run: record, scene: true, ffmpeg: true },
  render: { run: render, scene: true, ffmpeg: true },
  edit: { run: edit, scene: true, ffmpeg: true },
  login: { run: login, scene: true, ffmpeg: true },
  // check runs before the ffmpeg test: it needs neither ffmpeg nor Chrome.
  check: { run: check, scene: true, ffmpeg: false },
  // sources takes replay logs, not a scene, and needs ffmpeg only once it
  // has logs to render (see commands/sources.js).
  sources: { run: sources, scene: false, ffmpeg: false },
};
