// The documentation's examples stay true: every scene in docs/scenes/ is
// valid, is shown in examples.md exactly as it is in the file, and has the
// screenshots it is documented with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = path.join(ROOT, 'docs', 'scenes');
const md = readFileSync(path.join(ROOT, 'examples.md'), 'utf8');
const names = readdirSync(SCENES).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5));

test('there are scenes to document', () => {
  assert.ok(names.length >= 20, `${names.length} scenes`);
});

for (const name of names) {
  const text = readFileSync(path.join(SCENES, `${name}.yaml`), 'utf8');

  test(`docs/scenes/${name}.yaml: is shown in examples.md exactly as written`, () => {
    assert.ok(md.includes(`<!-- scene: ${name} -->\n\`\`\`yaml\n${text}\`\`\`\n`),
      `examples.md must hold docs/scenes/${name}.yaml verbatim after "<!-- scene: ${name} -->"`);
  });

  test(`docs/scenes/${name}.yaml: has a screenshot per format, and examples.md shows them`, () => {
    const formats = YAML.parse(text).formats ?? ['16x9'];
    for (const f of formats) {
      const img = `docs/img/${name}-${f}.png`;
      assert.ok(existsSync(path.join(ROOT, img)), `${img} is missing: run "make doc-images SCENES=${name}"`);
      assert.ok(md.includes(img), `examples.md should show ${img}`);
    }
  });

  test(`docs/scenes/${name}.yaml: passes "democast check" (the demo site's address aside)`, async () => {
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'check', path.join(SCENES, `${name}.yaml`)]);
    let out = '';
    for (const s of [child.stdout, child.stderr]) s.setEncoding('utf8').on('data', (d) => { out += d; });
    const status = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(status, 0, out);
    assert.match(out, /\nok\n?$/);
  });
}

test('every image in docs/img/ belongs to a scene and is shown', () => {
  const have = readdirSync(path.join(ROOT, 'docs', 'img')).filter((f) => f.endsWith('.png'));
  const wanted = new Set(names.flatMap((n) => (YAML.parse(readFileSync(path.join(SCENES, `${n}.yaml`), 'utf8')).formats ?? ['16x9']).map((f) => `${n}-${f}.png`)));
  assert.deepEqual(have.filter((f) => !wanted.has(f)), [], 'images no scene makes');
});

test('every image examples.md shows exists', () => {
  for (const m of md.matchAll(/docs\/img\/[\w-]+\.png/g)) assert.ok(existsSync(path.join(ROOT, m[0])), m[0]);
});
