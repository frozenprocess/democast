// The project's web page (scripts/build-site.mjs): it builds, every link and
// image in it resolves, it loads nothing from the network, and links to
// files in the repository go where they should.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { build, render, relink } from '../scripts/build-site.mjs';
import { tmpDir } from './tmp.js';

const REPO = 'https://github.com/example/democast';
const out = path.join(tmpDir('site'), '_site');
const withRepo = path.join(tmpDir('site'), '_site');
const problems = build({ out });
const problemsWithRepo = build({ out: withRepo, repo: `${REPO}/` });

const pages = ['index.html', 'examples.html', 'reference.html'];
const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test('the site builds: pages, styles, images, the demo video and its poster', () => {
  assert.deepEqual(problems, []);
  assert.deepEqual(problemsWithRepo, []);
  for (const f of [...pages, 'site.css', 'demo.mp4', 'poster.jpg', '.nojekyll']) assert.ok(existsSync(path.join(out, f)), f);
  const imgs = readdirSync(path.join(out, 'img'));
  assert.deepEqual(imgs.sort(), readdirSync('docs/img').sort(), 'every screenshot is copied');
});

for (const [name, dir] of [['without a repository URL', out], ['with one', withRepo]]) {
  test(`every link, image and anchor in the built pages resolves (${name})`, () => {
    for (const page of pages) {
      const html = read(dir, page);
      const refs = [...html.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(refs.length > 3, page);
      for (const ref of refs) {
        // Links to other sites (the README names a few) are fine; what the
        // page loads is checked below.
        if (/^https?:/.test(ref)) continue;
        const [file, hash] = ref.split('#');
        const target = file || page;
        assert.ok(existsSync(path.join(dir, target)) && statSync(path.join(dir, target)).isFile(), `${page}: ${ref} points at nothing`);
        if (hash) assert.ok(ids(read(dir, target)).has(hash), `${page}: ${ref} has no such heading`);
      }
    }
  });
}

test('the pages load nothing from the network', () => {
  for (const page of pages) {
    const html = read(out, page);
    assert.doesNotMatch(html, /<(?:link|script|img|video|source|iframe)\b[^>]*(?:href|src)="(?:https?:)?\/\//, page);
    assert.doesNotMatch(html, /url\(\s*['"]?https?:/, page);
  }
  assert.doesNotMatch(read(out, 'site.css'), /https?:\/\//);
});

test('links to files in the repository: the repository URL when known, else plain text', () => {
  const ex = read(out, 'examples.html');
  const exRepo = read(withRepo, 'examples.html');
  assert.match(exRepo, new RegExp(`href="${REPO}/tree/HEAD/docs/scenes"`), 'a folder');
  assert.match(exRepo, new RegExp(`href="${REPO}/tree/HEAD/docs/site"`));
  assert.doesNotMatch(ex, /href="[^"]*docs\/scenes/);
  assert.match(ex, /<span class="path">docs\/scenes\/<\/span>/);
  // Links between the two documents go to the built pages.
  assert.match(ex, /href="reference\.html"/);
  assert.match(read(out, 'reference.html'), /href="examples\.html"/);
  assert.match(ex, /src="img\/basics-16x9\.png"/);
});

test('headings get the ids GitHub gives them, so the Markdown\'s own anchors work', () => {
  const { html, title } = render('# Title here\n\n## 1. The basics\n\n## Stage: cards, captions, views\n\n## Again\n\n## Again\n');
  assert.equal(title, 'Title here');
  for (const id of ['title-here', '1-the-basics', 'stage-cards-captions-views', 'again', 'again-1']) assert.ok(html.includes(`id="${id}"`), id);
});

test('a link or image that points at nothing is a problem', () => {
  const found = [];
  relink('<a href="nope.md">x</a> <img src="docs/img/none.png"> <a href="README.md#a">ok</a> <a href="https://x.test/">ext</a> <a href="#here">h</a>', { repo: undefined, problems: found, from: 'f.md' });
  assert.deepEqual(found, ['f.md: nope.md points at nothing', 'f.md: docs/img/none.png points at nothing']);
});
