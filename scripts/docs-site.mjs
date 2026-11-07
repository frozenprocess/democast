// The demo site the documentation's examples run against: plain static
// pages in docs/site/, served on 127.0.0.1. Recordings of the examples never
// depend on a real service, so they work the same everywhere.
//
//   node scripts/docs-site.mjs          # serve until Ctrl-C (make docs-site)
//
// doc-images.mjs starts it too, through serve().

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 7799; // the scenes in docs/scenes/ name this port
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

// serve starts the site and resolves with the server once it listens.
export function serve(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, name === '/' ? 'index.html' : name);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await serve();
  console.log(`demo site on http://127.0.0.1:${PORT}/ (Ctrl-C to stop)`);
}
