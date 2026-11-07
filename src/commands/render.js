// democast render: render recorded takes again with the current edits.

import path from 'node:path';
import { renderTake } from '../encode.js';
import { findTakes, staleness } from '../project.js';
import { fail } from './common.js';

export async function render({ scene, sceneDir, edits, formats, outDir }) {
  const takes = findTakes(outDir, scene, formats);
  if (!takes.length) fail(`no recorded takes of ${scene.name} in ${path.relative('.', outDir) || '.'}; record first`);
  let failed = false;
  for (const take of takes) {
    const stale = staleness(take, scene);
    if (stale) console.warn(`${path.basename(take.base)}: warning: ${stale}`);
    try {
      const res = await renderTake({ take, scene, sceneDir, edits });
      console.log(`wrote ${path.relative('.', res.mp4)} (${res.duration.toFixed(1)}s)`);
    } catch (err) {
      console.error(`${path.basename(take.base)}: ${err.message}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}
