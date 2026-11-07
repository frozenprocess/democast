import { test } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { pageRedactor, redactRules } from '../src/redact.js';
import { findChrome } from '../src/browser.js';

const chrome = findChrome();

test('blurs values split across elements, not their labels', { skip: !chrome && 'no Chrome' }, async () => {
  const b = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    const p = await b.newPage();
    await p.evaluateOnNewDocument(pageRedactor, redactRules(['email', 'tailscale-ipv6', 'tailscale-ip', 'keys', { text: 'User' }]));
    await p.goto('data:text/html,' + encodeURIComponent(`
      <div><div>Creator</div><div>someone@example.com</div></div>
      <span><span>fd7a:115c</span><span>:a1e0::342a:5531</span></span>
      <p>IPv4 <b>100.101.7.9</b> and the name User</p>
      <input id=key readonly value="tskey-auth-kAbc123-XyZ"><input id=plain value="some-probe">`));
    const hl = await p.evaluate(() => [...CSS.highlights.get('democast-redact')].map((r) => r.toString()).sort());
    assert.deepEqual(await p.evaluate(() => ['key', 'plain'].map((id) => document.getElementById(id).hasAttribute('data-democast-redact'))), [true, false]);
    // "User" is the literal name, inside the email.
    assert.deepEqual(hl, ['100.101.7.9', 'fd7a:115c:a1e0::342a:5531', 'User', 'someone@example.com'].sort());
  } finally {
    await b.close();
  }
});

test('tailnet: blurs fun names, even half typed, not .ts file names', { skip: !chrome && 'no Chrome' }, async () => {
  const b = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    const p = await b.newPage();
    await p.evaluateOnNewDocument(pageRedactor, redactRules(['tailnet']));
    await p.goto('data:text/html,' + encodeURIComponent(`
      <ul><li>user-service.ts</li><li>build-tools.ts</li></ul>
      <p>Reach it at happy-otter.ts.net now</p>
      <p>Streaming: hello-share.ts.n</p>`));
    const hl = await p.evaluate(() => [...CSS.highlights.get('democast-redact')].map((r) => r.toString()).sort());
    assert.deepEqual(hl, ['happy-otter.ts.net', 'hello-share.ts.n']);
  } finally {
    await b.close();
  }
});
