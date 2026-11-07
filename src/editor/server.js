// Local server for the timeline editor (democast edit). It serves the
// editor page, each take's preview video and narration waveform, and saves
// and renders edits. It listens on localhost only, and answers only requests
// that carry its access token: a random one per run, in the URL it prints,
// which the first visit turns into a cookie. Other users and programs on the
// machine can reach the port, but can't read takes or start renders.

import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScene, loadEdits, saveEdits, findTakes, staleness, editsPath } from '../project.js';
import { previewTake, waveform, renderTake } from '../encode.js';
import { takePaths } from '../take.js';
import { checkEdits } from '../edits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = {
  '/': [path.join(HERE, 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [path.join(HERE, 'app.js'), 'text/javascript; charset=utf-8'],
  '/edits.js': [path.join(HERE, '..', 'edits.js'), 'text/javascript; charset=utf-8'],
};
// The page's modules: every file in ui/, and nothing else in this folder.
for (const f of readdirSync(path.join(HERE, 'ui')).filter((n) => n.endsWith('.js'))) {
  STATIC[`/ui/${f}`] = [path.join(HERE, 'ui', f), 'text/javascript; charset=utf-8'];
}

const COOKIE = 'democast_editor';

// hasToken: whether the request carries the token as its cookie.
function hasToken(req, token) {
  const given = /(?:^|;\s*)democast_editor=([^;]*)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
  return same(given, token);
}

// same compares two strings without leaking, by timing, how much matched.
function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function serve({ scenePath, outDir, port = 7717, open = false, token = randomBytes(24).toString('hex') }) {
  const sceneDir = path.dirname(scenePath);
  // The scene is re-read on each project load, so edits to the YAML show
  // up on reload; the last good parse is kept if the file is mid-edit.
  let scene = loadScene(scenePath);
  const takesById = () => new Map(findTakes(outDir, scene).map((t) => [path.basename(t.base), t]));
  let rendering = false;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const refused = refuse(req, /** @type {import('node:net').AddressInfo} */ (server.address()).port);
    if (refused) return json(res, { error: refused.error }, refused.status);
    // The link democast printed: keep the token as a cookie (not readable by
    // scripts, not sent from other sites) and drop it from the address bar.
    if (req.method === 'GET' && url.pathname === '/' && same(url.searchParams.get('token') ?? '', token)) {
      res.writeHead(302, { Location: '/', 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!hasToken(req, token)) return json(res, { error: 'missing access token: open the link democast printed' }, 403);
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(readFileSync(file));
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/api/project') {
        try {
          scene = loadScene(scenePath);
        } catch {}
        const takes = [...takesById().entries()].map(([id, t]) => ({
          id,
          format: t.format,
          scale: t.scale,
          fps: t.fps,
          width: t.width,
          height: t.height,
          safe: t.safe,
          duration: t.duration,
          recorded: t.recorded,
          steps: t.steps,
          narration: (t.narration ?? []).map(({ text, start, duration }) => ({ text, start, duration })),
          stale: staleness(t, scene),
          rendered: existsSync(takePaths(t.base).mp4),
        }));
        return json(res, {
          scene: { name: scene.name, path: path.relative(process.cwd(), scenePath), music: Boolean(scene.music) },
          editsFile: path.relative(process.cwd(), editsPath(scenePath)),
          takes,
          edits: loadEdits(scenePath),
        });
      }
      let m;
      if (req.method === 'GET' && (m = url.pathname.match(/^\/media\/([^/]+)$/))) {
        const take = takesById().get(decodeURIComponent(m[1]));
        if (!take) return notFound(res);
        return sendFile(req, res, await previewTake(take), 'video/mp4');
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/output\/([^/]+)$/))) {
        const take = takesById().get(decodeURIComponent(m[1]));
        const file = take && takePaths(take.base).mp4;
        if (!file || !existsSync(file)) return notFound(res);
        return sendFile(req, res, file, 'video/mp4');
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/waveform\/([^/]+)$/))) {
        const take = takesById().get(decodeURIComponent(m[1]));
        if (!take) return notFound(res);
        return json(res, { rate: 50, peaks: await waveform(take, 50) });
      }
      if (req.method === 'POST' && url.pathname === '/api/edits') {
        let edits;
        try {
          edits = checkEdits(JSON.parse(await body(req)));
        } catch (err) {
          return json(res, { error: err.message }, 400);
        }
        saveEdits(scenePath, edits);
        return json(res, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/render') {
        if (rendering) return json(res, { error: 'a render is already running' }, 409);
        const all = takesById();
        let ids;
        try {
          ({ ids } = JSON.parse(await body(req)));
        } catch {
          return json(res, { error: 'want JSON: { "ids": [take ids] }' }, 400);
        }
        if (!Array.isArray(ids) || ids.length > all.size || !ids.every((id) => typeof id === 'string')) {
          return json(res, { error: '"ids" must be a list of take ids, each at most once' }, 400);
        }
        const unknown = ids.filter((id) => !all.has(id));
        if (unknown.length || new Set(ids).size !== ids.length) {
          return json(res, { error: unknown.length ? `no such take: ${unknown.join(', ')}` : '"ids" lists a take twice' }, 400);
        }
        const takes = ids.map((id) => /** @type {any} */ (all.get(id)));
        rendering = true;
        // Stream one JSON object per line as each take finishes.
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
        try {
          const edits = loadEdits(scenePath);
          for (const take of takes) {
            const id = path.basename(take.base);
            res.write(JSON.stringify({ id, status: 'rendering' }) + '\n');
            try {
              const out = await renderTake({ take, scene, sceneDir, edits });
              res.write(JSON.stringify({ id, status: 'done', duration: out.duration, file: path.relative(process.cwd(), out.mp4) }) + '\n');
            } catch (err) {
              res.write(JSON.stringify({ id, status: 'failed', error: err.message }) + '\n');
            }
          }
        } finally {
          rendering = false;
          res.end();
        }
        return;
      }
      notFound(res);
    } catch (err) {
      if (!res.headersSent) json(res, { error: err.message }, 500);
      else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(undefined));
  });
  const address = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/?token=${token}`;
  console.log(`democast editor: ${address}`);
  console.log(`  scene ${path.relative(process.cwd(), scenePath)}, takes in ${path.relative(process.cwd(), outDir) || '.'}`);
  console.log('  press Ctrl+C to stop');
  if (open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [address], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
  return server;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  json(res, { error: 'not found' }, 404);
}

// refuse says why a request isn't from the editor's own page, or returns
// null. Listening on 127.0.0.1 isn't enough: any site open in the browser
// can send requests there, and with DNS rebinding read the answers. A
// rebound name arrives in Host; a cross-site form or fetch carries its
// Origin, and can't send JSON without a preflight this server never
// answers.
function refuse(req, port) {
  const own = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!own.includes(req.headers.host?.toLowerCase())) return { status: 403, error: 'unknown host' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin != null && !own.some((h) => origin.toLowerCase() === `http://${h}`)) return { status: 403, error: 'cross-origin request' };
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return { status: 415, error: 'want Content-Type: application/json' };
  }
  return null;
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      data += d;
      if (data.length > 1 << 20) {
        req.destroy();
        reject(new Error('request too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// sendFile serves a file with HTTP range support, which the video element
// needs for seeking.
function sendFile(req, res, file, type) {
  const size = statSync(file).size;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}
