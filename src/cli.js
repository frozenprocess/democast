#!/usr/bin/env node
// democast: record scripted demo videos from a YAML scene file.
// This file parses the command line and runs the command; each command is
// in commands/.

import { parseArgs } from 'node:util';
import { defaultJobs } from './sources.js';
import { COMMANDS } from './commands/index.js';
import { OPTIONS } from './commands/options.js';
import { usage } from './commands/usage.js';
import { CliError, fail, openScene, requireFfmpeg } from './commands/common.js';

// dispatch runs the command the arguments name and returns its exit status
// (undefined: keep running).
async function dispatch(argv) {
  const { values: flags, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const name = Object.hasOwn(COMMANDS, positionals[0]) ? positionals.shift() : 'record';
  const command = COMMANDS[name];
  const jobs = flags.jobs ? Number(flags.jobs) : defaultJobs();
  if (!(Number.isInteger(jobs) && jobs > 0)) fail(`--jobs must be a whole number above 0, got ${flags.jobs}`);

  // sources takes any number of logs; the others, one scene.
  if (flags.help || (command.scene ? positionals.length !== 1 : !positionals.length)) {
    process.stdout.write(usage());
    return flags.help ? 0 : 2;
  }
  const scene = command.scene ? openScene(flags, positionals) : {};
  if (command.ffmpeg) requireFfmpeg();
  return command.run({ flags, positionals, jobs, ...scene });
}

try {
  const status = await dispatch(process.argv.slice(2));
  if (status !== undefined) process.exit(status);
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  console.error(`democast: ${err.message}`);
  process.exit(1);
}
