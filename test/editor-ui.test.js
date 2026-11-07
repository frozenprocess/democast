// The timeline editor in a real browser: it loads a recorded take with no
// errors, and the main edits work (add, undo, drag, save). Skipped without
// Chrome or ffmpeg, like the end-to-end test.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../src/browser.js';
import { serve } from '../src/editor/server.js';
import { tmpDir } from './tmp.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const chrome = findChrome();
const missing = !chrome ? 'no Chrome' : !has('ffmpeg') ? 'no ffmpeg' : false;

test('editor page: loads a take, and add, undo, drag and save work', { skip: missing, timeout: 180000 }, async () => {
  const dir = tmpDir('editor-ui');
  const scenePath = path.join(dir, 'term.yaml');
  const out = path.join(dir, 'out');
  writeFileSync(scenePath, 'steps:\n  - term.run: "echo hello"\n  - wait: 3000\n');
  execFileSync(process.execPath, [CLI, '--no-voice', '-f', '16x9', '-o', out, scenePath], { stdio: 'pipe' });

  const log = console.log;
  console.log = () => {};
  const server = await serve({ scenePath, outDir: out, port: 0, token: 'ui-test' });
  console.log = log;
  after(() => server.close());

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });

    // The printed link: its token becomes the cookie the page's requests carry.
    await page.goto(`http://localhost:${server.address().port}/?token=ui-test`);
    await page.waitForFunction(() => document.querySelector('#outInfo')?.textContent.startsWith('output'), { timeout: 30000 });
    const count = (sel) => page.$$eval(sel, (els) => els.length);
    const regions = () => count('.region');

    assert.match(await page.title(), /term — democast editor/);
    assert.ok(await count('.block') >= 2, 'the steps are on the timeline');
    assert.ok(await count('.tick') > 0, 'the ruler has ticks');
    assert.equal(await page.$eval('#save', (b) => b.disabled), true, 'nothing to save yet');

    // Clicking the ruler moves the playhead there.
    const ruler = await (await page.$('#ruler')).boundingBox();
    await page.mouse.click(ruler.x + 300, ruler.y + 10);
    assert.ok(await page.$eval('video', (v) => v.currentTime) > 0, 'the video seeks');
    assert.equal(await page.$eval('#playhead', (e) => e.style.left), '300px', 'the playhead is at the click');

    // Dragging on the empty Edits lane makes a new region.
    const box = await (await page.$('#lane-edits')).boundingBox();
    await page.mouse.move(box.x + 300, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 40, { steps: 4 });
    await page.mouse.up();
    assert.equal(await regions(), 1);

    // c adds a cut at the playhead; the inspector shows it; Ctrl-Z removes it.
    await page.keyboard.press('c');
    assert.equal(await regions(), 2);
    assert.match(await page.$eval('#inspector', (e) => e.textContent), /Type/);
    assert.equal(await page.$eval('#save', (b) => b.textContent), 'Save •');
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    assert.equal(await regions(), 1);

    // A text region shows its text over the video preview.
    await page.keyboard.press('t');
    assert.equal(await count('.region.text'), 1);
    await page.type('#f-text', '!');
    assert.match(await page.$eval('#overlay', (e) => e.textContent), /!$/);

    // Saving writes the edits file and clears the unsaved mark.
    await page.click('#save');
    await page.waitForFunction(() => document.querySelector('#save').textContent === 'Save');
    const edits = path.join(dir, 'term.edits.yaml');
    assert.ok(existsSync(edits), 'the edits file is written next to the scene');
    assert.match(readFileSync(edits, 'utf8'), /type: text/);

    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});
