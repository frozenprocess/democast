import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { terminalOps, writeTerminalHtml, rhythm } from '../src/termhtml.js';
import { tmpDir } from './tmp.js';

const log = (events, cfg = { term: { w: 700 }, termTitle: 'bash' }) => ({ scene: 's', t0: 1000, duration: 5, cfg, events });

test('terminalOps: starts with a prompt, routes panes, times from the take start', () => {
  const ops = terminalOps(log([
    { t: 900, fn: 'print', args: ['early\n', 'out', 'term'] },
    { t: 1500, fn: 'print', args: ['two\n', 'out', 'term2'] },
    { t: 2000, fn: 'clear', args: ['term'] },
  ]));
  assert.deepEqual(ops.term, [
    { t: 0, k: 'print', x: '$ ', c: 'prompt' },
    { t: 0, k: 'print', x: 'early\n', c: 'out' },
    { t: 1000, k: 'clear' },
    { t: 1000, k: 'print', x: '$ ', c: 'prompt' },
  ]);
  assert.deepEqual(ops.term2.at(-1), { t: 500, k: 'print', x: 'two\n', c: 'out' });
});

test('terminalOps: typing follows the stage rhythm, whole milliseconds', () => {
  const [a] = terminalOps(log([{ t: 2000, fn: 'type', args: ['abcd', 50, 'term'] }])).term.slice(1);
  assert.equal(a.t, 1000);
  assert.equal(a.d[0], 0);
  assert.equal(a.d.length, 4);
  for (let i = 1; i < 4; i++) {
    const gap = a.d[i] - a.d[i - 1];
    assert.ok(Number.isInteger(gap) && gap >= 12 && gap < 28, `gap ${gap}`); // 20 ms × 0.6–1.4
  }
  // The same calls give the same rhythm.
  assert.deepEqual(terminalOps(log([{ t: 2000, fn: 'type', args: ['abcd', 50, 'term'] }])).term[1].d, a.d);
});

test('writeTerminalHtml: one page per terminal, data kept out of the markup', () => {
  const dir = tmpDir('th');
  const logDir = path.join(dir, 'scene-16x9.log');
  mkdirSync(logDir);
  writeFileSync(path.join(logDir, 'log.json'), JSON.stringify(log(
    [{ t: 1200, fn: 'print', args: ['</script><b>\n', 'out', 'term'] }],
    { term: { w: 700 }, term2: { w: 700 }, termTitle: 'one', term2Title: 'two' })));
  const files = writeTerminalHtml(logDir);
  assert.deepEqual(files.map((f) => path.basename(f)), ['scene-16x9-terminal.html', 'scene-16x9-terminal2.html']);
  const html = readFileSync(files[0], 'utf8');
  assert.equal(html.split('</script>').length, 3); // the two scripts' own, not the printed one
  assert.deepEqual(writeTerminalHtml(logDir), []); // up to date
});

test('rhythm: a seed gives the same sequence every time', () => {
  const take = (seed, n = 5) => { const r = rhythm(seed); return Array.from({ length: n }, r); };
  assert.deepEqual(take(7), take(7));
  assert.notDeepEqual(take(7), take(8));
  assert.deepEqual(take(), take(1));
  assert.ok(take(7, 100).every((x) => x >= 0 && x < 1));
});
