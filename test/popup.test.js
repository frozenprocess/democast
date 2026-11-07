// browser.popup in real Chrome: the site opens a popup, the step clicks in
// it, and the scene carries on. Skipped without Chrome or ffmpeg.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { tmpDir } from './tmp.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const skip = !findChrome() ? 'no Chrome' : !has('ffmpeg') ? 'no ffmpeg' : false;

// The site: a page whose button opens /pop, a popup with an OK button that
// reports its click to the server and closes itself, and an "After" button
// on the main page that reports its click too.
const hits = [];
let server;
let site;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      hits.push(req.url);
      res.writeHead(204);
      return res.end();
    }
    res.setHeader('content-type', 'text/html');
    if (req.url.startsWith('/pop')) {
      res.end('<body style="font:30px sans-serif"><h1>Popup</h1>' +
        '<button id="ok" onclick="fetch(\'/ok\', { method: \'POST\', keepalive: true }); window.close()">OK</button></body>');
    } else {
      res.end('<body style="font:30px sans-serif"><h1>Main</h1>' +
        '<button id="open" onclick="window.open(\'/pop\', \'p\', \'width=500,height=400\')">Open</button><br>' +
        '<button id="after" onclick="fetch(\'/after\', { method: \'POST\' })">After</button></body>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

// run records a scene against the site. The server above lives in this
// process, so the CLI is run asynchronously: a blocked process couldn't
// answer Chrome.
async function run(steps, { timeout = 10000 } = {}) {
  const dir = tmpDir('popup');
  hits.length = 0;
  const scene = path.join(dir, 'p.yaml');
  writeFileSync(scene, `timeout: ${timeout}\nsite: ${site}\nsteps:\n${steps}`);
  const child = spawn(process.execPath, [CLI, '--no-voice', '-f', '16x9', '-o', path.join(dir, 'out'), scene], { timeout: 90000 });
  let text = '';
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', (d) => { text += d; });
  const status = await new Promise((resolve) => child.on('close', resolve));
  return { status, text };
}

test('browser.popup: the trigger opens the popup, the click lands in it, the scene goes on', { skip, timeout: 120000 }, async () => {
  const r = await run('  - browser.popup: { trigger: "#open", click: "#ok", url: "/pop" }\n  - browser.click: "#after"\n  - wait: 300\n');
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(hits.sort(), ['/after', '/ok']);
});

test('browser.popup: unless skips the step when a popup already shows that', { skip, timeout: 120000 }, async () => {
  // The trigger opens the popup, which shows #ok, so the step is done
  // without clicking it.
  const r = await run('  - browser.popup: { trigger: "#open", click: "#ok", unless: "#ok" }\n  - wait: 300\n');
  assert.equal(r.status, 0, r.text);
  assert.match(r.text, /skipped: a popup already shows #ok/);
  assert.deepEqual(hits, []);
});

test('browser.popup: names what the popups showed when the selector never appears', { skip, timeout: 120000 }, async () => {
  const r = await run('  - browser.popup: { trigger: "#open", click: "#nope" }\n', { timeout: 3000 });
  assert.equal(r.status, 1);
  assert.match(r.text, /no popup window showed #nope within 3000ms; popups: .*\/pop: Popup OK/);
  assert.deepEqual(hits, []);
});

test('browser.popup: without a popup it times out saying there were none', { skip, timeout: 120000 }, async () => {
  const r = await run('  - browser.popup: { click: "#ok" }\n', { timeout: 2000 });
  assert.equal(r.status, 1);
  assert.match(r.text, /no popup window showed #ok within 2000ms; popups: none/);
});
