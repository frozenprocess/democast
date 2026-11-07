import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { serve } from '../src/editor/server.js';
import { tmpDir } from './tmp.js';

const dir = tmpDir('editor');
const scenePath = path.join(dir, 'demo.yaml');
writeFileSync(scenePath, 'steps:\n  - wait: 100\n');
const log = console.log;
console.log = () => {};
const TOKEN = 'test-token';
const server = await serve({ scenePath, outDir: path.join(dir, 'out'), port: 0, token: TOKEN });
console.log = log;
const port = server.address().port;
after(() => server.close());

// send makes a request with exactly these headers (fetch won't set Host), and
// the access cookie unless told otherwise. It resolves with the status; full
// gives the response too.
const cookie = { cookie: `democast_editor=${TOKEN}` };
function send(method, url, headers = {}, body) {
  return full(method, url, headers, body).then((r) => r.status);
}
function full(method, url, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: `localhost:${port}`, ...cookie, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const edits = JSON.stringify({ regions: [] });
const asJson = { 'content-type': 'application/json' };

test('editor: answers its own page', async () => {
  assert.equal(await send('GET', '/api/project'), 200);
  assert.equal(await send('GET', '/api/project', { host: `127.0.0.1:${port}` }), 200);
  assert.equal(await send('POST', '/api/edits', { ...asJson, origin: `http://localhost:${port}` }, edits), 200);
  assert.ok(existsSync(path.join(dir, 'demo.edits.yaml')));
});

test('editor: refuses another host (DNS rebinding)', async () => {
  assert.equal(await send('GET', '/api/project', { host: `evil.example:${port}` }), 403);
  assert.equal(await send('GET', '/api/project', { host: 'localhost:1' }), 403);
});

test('editor: refuses cross-origin and non-JSON writes', async () => {
  assert.equal(await send('POST', '/api/edits', { ...asJson, origin: 'http://evil.example' }, edits), 403);
  assert.equal(await send('POST', '/api/edits', { 'content-type': 'text/plain' }, edits), 415);
  assert.equal(await send('POST', '/api/render', { origin: 'null', ...asJson }, '{"ids":[]}'), 403);
});

test('editor: refuses malformed edits without saving them', async () => {
  const bad = JSON.stringify({ regions: [{ type: 'blur' }] });
  assert.equal(await send('POST', '/api/edits', asJson, bad), 400);
  assert.equal(await send('GET', '/api/project'), 200);
});

test('editor: needs the access token; the printed link sets it as a cookie', async () => {
  const none = { cookie: '' };
  assert.equal(await send('GET', '/api/project', none), 403);
  assert.equal(await send('GET', '/', none), 403);
  assert.equal(await send('GET', '/api/project', { cookie: 'democast_editor=wrong' }), 403);
  assert.equal(await send('GET', '/api/project', { cookie: 'democast_editor=test-token-and-more' }), 403);
  assert.equal(await send('POST', '/api/edits', { ...none, ...asJson }, edits), 403);
  assert.equal(await send('GET', '/?token=wrong', none), 403);
  const r = await full('GET', `/?token=${TOKEN}`, none);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/');
  assert.match(String(r.headers['set-cookie']), /^democast_editor=test-token; Path=\/; HttpOnly; SameSite=Strict$/);
  assert.equal((await full('GET', '/', cookie)).headers['x-content-type-options'], 'nosniff');
});

test('editor: /api/render checks its input before doing anything', async () => {
  const render = (body) => full('POST', '/api/render', asJson, body);
  for (const bad of ['not json', '{}', '{"ids":"a"}', '{"ids":[1]}', '{"ids":["nope"]}', '{"ids":["a","a"]}', 'null', '[]']) {
    const r = await render(bad);
    assert.equal(r.status, 400, `${bad}: ${r.text}`);
    assert.match(JSON.parse(r.text).error, /./);
  }
  assert.equal((await render('{"ids":[]}')).status, 200, 'an empty list is nothing to render');
});
