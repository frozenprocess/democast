// Running ffmpeg and ffprobe: one place for how they're started and how
// their failures are reported.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// hasFfmpeg tells whether ffmpeg can be run.
export function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ffmpeg runs ffmpeg to completion and resolves to { stdout, stderr }.
// options go to execFile; stdout may be large (raw audio), so the buffer
// is generous.
export function ffmpeg(args, options = {}) {
  return execFileP('ffmpeg', args, { maxBuffer: 1 << 24, ...options });
}

// startFfmpeg starts ffmpeg in the background and returns { proc, done }.
// done resolves when it exits cleanly and rejects with its stderr
// otherwise, naming the job as label. stdin is 'pipe' to feed it frames
// (proc.stdin) or 'ignore'.
/**
 * @param {string[]} args
 * @param {{ label: string, stdin?: 'pipe' | 'ignore' }} options
 * @returns {{ proc: import('node:child_process').ChildProcess & { stdin: import('node:stream').Writable }, done: Promise<void> }}
 *   proc.stdin is there only with stdin: 'pipe'.
 */
export function startFfmpeg(args, { label, stdin = 'ignore' }) {
  const proc = /** @type {any} */ (spawn('ffmpeg', args, { stdio: [stdin, 'ignore', 'pipe'] }));
  let err = '';
  proc.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`${label}: exit status ${code}\n${err}`))));
  });
  return { proc, done };
}

// duration is the length of a media file in seconds, from ffprobe.
export async function duration(file) {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}
