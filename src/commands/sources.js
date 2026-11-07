// democast sources: render each window alone from kept replay logs.

import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { renderSources } from '../sources.js';
import { chromeFor, fail, requireFfmpeg } from './common.js';

// logDirsIn lists the replay logs the arguments name: a log folder itself,
// or every *.log in a folder.
function logDirsIn(args) {
  const logDirs = [];
  for (const p of args.map((x) => path.resolve(x))) {
    if (!existsSync(p) || !statSync(p).isDirectory()) fail(`${p}: not a directory`);
    if (existsSync(path.join(p, 'log.json'))) logDirs.push(p);
    else logDirs.push(...readdirSync(p).filter((n) => n.endsWith('.log') && existsSync(path.join(p, n, 'log.json'))).sort().map((n) => path.join(p, n)));
  }
  return logDirs;
}

export async function sources({ flags, positionals, jobs }) {
  const logDirs = logDirsIn(positionals);
  if (!logDirs.length) fail('no replay logs found (record with --sources-later or --sources)');
  // The renders are encoded with ffmpeg; with no logs there's nothing to render.
  requireFfmpeg();
  const chrome = chromeFor(flags);
  const t = Date.now();
  let files;
  try {
    files = await renderSources(logDirs, { chrome, jobs, force: flags.force, log: (m) => console.log(m) });
  } catch (err) {
    return fail(err.message);
  }
  console.log(`${files.length} source${files.length === 1 ? '' : 's'} from ${logDirs.length} log${logDirs.length === 1 ? '' : 's'}, ${jobs} at a time, in ${((Date.now() - t) / 1000).toFixed(0)}s`);
  return 0;
}
