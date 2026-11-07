// tmpDir makes a temporary directory that is removed once the file's tests
// have run.

import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

export function tmpDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `democast-${prefix}-`));
  dirs.push(dir);
  return dir;
}
