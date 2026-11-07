// What democast fetches or runs from outside, kept pinned and checked:
// the CI workflow, the narration engines, and the pages it writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminalOps } from '../src/termhtml.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('CI: a read-only token, and every action pinned to a commit', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  for (const f of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    assert.match(text, /^permissions:\n {2}contents: read$/m, `${f}: permissions: contents: read`);
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${f}: ${u} should name a commit, not a tag`);
  }
});

test('kokoro engine: exact package versions, and a SHA-256 for every file it downloads', () => {
  const py = read('tts/kokoro_engine.py');
  const deps = /^# dependencies = \[(.*)\]$/m.exec(py)?.[1] ?? '';
  for (const d of deps.split(',').map((x) => x.trim().replace(/"/g, ''))) assert.match(d, /^[\w.-]+==[\d.]+$/, `unpinned: ${d}`);
  const files = [...py.matchAll(/"(kokoro-v1\.0[\w.]*\.onnx|voices-v1\.0\.bin)"/g)].map((m) => m[1]);
  assert.ok(files.length >= 3);
  const sums = Object.fromEntries([...py.matchAll(/"([\w.-]+)": "([0-9a-f]{64})"/g)].map((m) => [m[1], m[2]]));
  for (const f of new Set(files)) assert.ok(sums[f], `${f} has no SHA-256`);
  assert.match(py, /does not match its expected SHA-256/);
});

test('vibevoice engine: the package and the voice files are pinned to one commit', () => {
  const py = read('tts/vibevoice_engine.py');
  const commit = /^COMMIT = "([0-9a-f]{40})"/m.exec(py)?.[1];
  assert.ok(commit, 'COMMIT is a full hash');
  assert.ok(py.includes(`VibeVoice@${commit}`), 'the package is the same commit');
  assert.ok(/transformers==[\d.]+/.test(py));
});

test('terminal source pages load nothing from the network', () => {
  const src = read('src/termhtml.js');
  assert.doesNotMatch(src, /<link[^>]+href="https?:/);
  assert.doesNotMatch(src, /<script[^>]+src="https?:/);
  assert.doesNotMatch(src, /@import\s+url\(\s*['"]?https?:/);
  assert.equal(typeof terminalOps, 'function');
});
