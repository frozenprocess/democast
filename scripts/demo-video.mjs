// Records docs/demo/demo.yaml against the demo site and saves the 16:9 take
// as docs/demo/demo.mp4, the video on the project's web page, with a still
// from it (docs/demo/poster.jpg) to show until it plays.
//
//   node scripts/demo-video.mjs        # make demo-video
//
// The video is committed, so building the web page needs neither Chrome nor
// a recording; run this when the demo scene or democast's look changes.

import { spawn } from 'node:child_process';
import { copyFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, PORT } from './docs-site.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'demo');

let server;
try {
  server = await serve();
} catch (err) {
  console.error(`demo-video: can't start the demo site on port ${PORT}: ${err.message}`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
// Asynchronously: the demo site runs in this process, and a blocked process
// couldn't answer Chrome.
const status = await new Promise((resolve) => {
  spawn(process.execPath, ['src/cli.js', '--no-voice', '-q', '-f', '16x9', '-o', OUT, 'docs/demo/demo.yaml'], { cwd: ROOT, stdio: 'inherit' })
    .on('error', () => resolve(1)).on('close', resolve);
});
server.close();
if (status !== 0) process.exit(status ?? 1);

const dest = path.join(ROOT, 'docs', 'demo', 'demo.mp4');
copyFileSync(path.join(OUT, 'democast-demo-16x9.mp4'), dest);
const poster = path.join(ROOT, 'docs', 'demo', 'poster.jpg');
const still = await new Promise((resolve) => {
  // Seconds into the video: the sign-in and the terminal side by side.
  spawn('ffmpeg', ['-v', 'error', '-y', '-ss', '12', '-i', dest, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', poster], { stdio: 'inherit' })
    .on('error', () => resolve(1)).on('close', resolve);
});
if (still !== 0) process.exit(1);
console.log(`docs/demo/demo.mp4 (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
