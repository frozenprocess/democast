// The scene's credentials (basic auth, extra headers) go to the site's own
// origin only, and profile names can't leave the profiles folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { findChrome, launch, setupSitePage, siteGuard, withHeaders, profileDir } from '../src/browser.js';

const skip = findChrome() ? false : 'no Chrome';

test('siteGuard: only the site\'s origin; the first page decides without a site', () => {
  const g = siteGuard('http://a.test:8080/app');
  assert.ok(g.allows('http://a.test:8080/x?y') && g.allowsChallenge('http://a.test:8080'));
  assert.ok(!g.allows('http://a.test:8081/') && !g.allows('https://a.test:8080/') && !g.allows('http://b.test:8080/'));
  assert.ok(!g.allowsChallenge('http://b.test:8080') && !g.allows('not a url'));
  const open = siteGuard(undefined);
  assert.ok(!open.allows('http://a.test/'));
  open.seen('http://a.test/img.png', 'Image');
  assert.ok(!open.allows('http://a.test/'), 'only a document request sets it');
  open.seen('http://a.test/', 'Document');
  open.seen('http://b.test/', 'Document');
  assert.ok(open.allows('http://a.test/x') && !open.allows('http://b.test/'));
});

test('withHeaders: adds, replacing a header of the same name in any case', () => {
  assert.deepEqual(withHeaders({ Accept: '*/*', authorization: 'old' }, { Authorization: 'new', 'X-Key': 1 }), [
    { name: 'Accept', value: '*/*' }, { name: 'Authorization', value: 'new' }, { name: 'X-Key', value: '1' },
  ]);
});

test('profileDir: names cannot reach outside the profiles folder', () => {
  for (const bad of ['.', '..', '.hidden', '-x', 'a/b', '']) assert.throws(() => profileDir(bad), /profile names/, bad);
  for (const good of ['work', 'my.profile-2', '_x', '9']) assert.match(profileDir(good), /profiles[\\/][^\\/]+$/);
});

// Two servers, so two origins; each records what it was sent and demands
// basic auth on /secret.
const seen = { a: [], b: [] };
const servers = [];
const origin = {};
function start(name, page) {
  const s = http.createServer((req, res) => {
    seen[name].push({ url: req.url, authorization: req.headers.authorization, key: req.headers['x-key'] });
    if (req.url === '/secret' && !req.headers.authorization) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' });
      return res.end('no');
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `${origin.b}/landed` });
      return res.end();
    }
    res.setHeader('content-type', 'text/html');
    res.end(page(req));
  });
  servers.push(s);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => { origin[name] = `http://127.0.0.1:${s.address().port}`; resolve(undefined); }));
}
before(async () => {
  if (skip) return;
  await start('b', () => 'b');
  await start('a', (req) => (req.url === '/' ? `<body>a<img src="${origin.b}/pic"><iframe src="${origin.b}/secret"></iframe>` +
    '<script>fetch("/secret").then(r => r.text())</script>' : 'a'));
});
after(() => servers.forEach((s) => s.close()));

async function visit(path, opts) {
  seen.a.length = seen.b.length = 0;
  const browser = await launch({ chrome: /** @type {string} */ (findChrome()), width: 800, height: 600 });
  try {
    const page = (await browser.pages())[0];
    await setupSitePage(page, { auth: { username: 'u', password: 'p' }, headers: { 'X-Key': 'k' }, site: origin.a, ...opts });
    await page.goto(origin.a + path, { waitUntil: 'networkidle0' });
  } finally {
    await browser.close();
  }
}
const basic = 'Basic ' + Buffer.from('u:p').toString('base64');

test('credentials and headers reach the site, and nothing on another origin', { skip, timeout: 60000 }, async () => {
  await visit('/');
  const own = seen.a.find((r) => r.url === '/secret');
  assert.equal(own.authorization, undefined, 'first try carries no credentials until challenged');
  assert.ok(seen.a.some((r) => r.url === '/secret' && r.authorization === basic), 'answered the site\'s own challenge');
  assert.ok(seen.a.every((r) => r.key === 'k'), 'the site gets the header');
  assert.ok(seen.b.length >= 2, 'the other origin was loaded');
  for (const r of seen.b) {
    assert.equal(r.authorization, undefined, `no password to ${r.url}`);
    assert.equal(r.key, undefined, `no header to ${r.url}`);
  }
});

test('a redirect to another origin drops the header', { skip, timeout: 60000 }, async () => {
  await visit('/redirect');
  assert.equal(seen.a.find((r) => r.url === '/redirect').key, 'k');
  assert.equal(seen.b.find((r) => r.url === '/landed').key, undefined);
});
