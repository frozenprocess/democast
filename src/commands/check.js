// democast check: look over a scene without running it.

import path from 'node:path';
import { checkScene } from '../check.js';
import { findTakes, staleness } from '../project.js';

export function check({ scene, sceneDir, edits, formats, outDir }) {
  const { problems, summary } = checkScene(scene, sceneDir, { formats });
  for (const line of summary) console.log(line);
  const takes = findTakes(outDir, scene, formats);
  const stale = takes.filter((t) => staleness(t, scene));
  console.log(`takes: ${takes.length} in ${path.relative('.', outDir) || '.'}${stale.length ? ` (${stale.length} recorded before the steps changed)` : ''}`);
  const regions = edits.regions?.length ?? 0;
  console.log(`edits: ${regions} region(s)${edits.trim?.start || edits.trim?.end ? ', trimmed' : ''}`);
  for (const p of problems) console.error(`problem: ${p}`);
  console.log(problems.length ? `${problems.length} problem(s)` : 'ok');
  return problems.length ? 1 : 0;
}
