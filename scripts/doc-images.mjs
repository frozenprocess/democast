// Records the scenes in docs/scenes/ against the demo site and saves one
// screenshot of each into docs/img/, for examples.md.
//
//   node scripts/doc-images.mjs [name ...]     # all scenes, or just these
//
// Each scene is <name>.yaml; a screenshot is written per format, as
// docs/img/<name>-<format>.png. By default the frame is taken just before
// the end of the video, so a scene should finish on the state worth showing.
// A comment line "# shot: 2.5" in the scene's first lines picks a time in
// seconds instead. Recordings go to out/docs/ (not committed).

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, PORT } from './docs-site.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = path.join(ROOT, 'docs', 'scenes');
const IMG = path.join(ROOT, 'docs', 'img');
const OUT = path.join(ROOT, 'out', 'docs');

// run runs a command to the end and resolves with its status and output.
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT });
    let text = '';
    for (const s of [child.stdout, child.stderr]) s.setEncoding('utf8').on('data', (d) => { text += d; });
    child.on('error', (e) => resolve({ status: 1, text: String(e) }));
    child.on('close', (status) => resolve({ status, text }));
  });
}

// duration is a video's length in seconds.
async function duration(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number.parseFloat(r.text);
}

const wanted = process.argv.slice(2);
const names = readdirSync(SCENES).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5))
  .filter((n) => !wanted.length || wanted.includes(n));
if (wanted.length && names.length !== wanted.length) {
  console.error(`no such scene: ${wanted.filter((w) => !names.includes(w)).join(', ')} (see docs/scenes/)`);
  process.exit(1);
}

let server;
try {
  server = await serve();
} catch (err) {
  console.error(`doc-images: can't start the demo site on port ${PORT}: ${err.message}`);
  process.exit(1);
}
mkdirSync(IMG, { recursive: true });
let failed = 0;
for (const name of names) {
  const scene = path.join(SCENES, `${name}.yaml`);
  const out = path.join(OUT, name);
  rmSync(out, { recursive: true, force: true });
  const shot = readFileSync(scene, 'utf8').match(/^# shot: ([\d.]+)/m)?.[1];
  const rec = await run(process.execPath, ['src/cli.js', '--no-voice', '-q', '-o', out, scene]);
  if (rec.status !== 0) {
    console.error(`${name}: recording failed\n${rec.text}`);
    failed++;
    continue;
  }
  for (const mp4 of readdirSync(out).filter((f) => f.endsWith('.mp4') && !f.includes('-guides'))) {
    const format = mp4.slice(name.length + 1, -4); // <name>-<format>.mp4
    const file = path.join(out, mp4);
    const at = shot ? Number(shot) : Math.max(0, (await duration(file)) - 0.5);
    const png = path.join(IMG, `${name}-${format}.png`);
    // Half size: sharp enough for a page of docs, light enough to commit.
    const r = await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=iw/2:-2', png]);
    if (r.status !== 0) { console.error(`${name}: ${r.text}`); failed++; continue; }
    console.log(`docs/img/${name}-${format}.png`);
  }
}
server.close();
process.exit(failed ? 1 : 0);
