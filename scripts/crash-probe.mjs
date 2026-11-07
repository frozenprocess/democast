// crash-probe opens a site in a copy of a saved profile, again and again,
// and counts how often the page shows an error, to find window sizes and
// scales the site breaks at.
//
// usage: node scripts/crash-probe.mjs PROFILE URL WIDTH HEIGHT DSF RUNS [TEXT]
// TEXT is what the page shows when it breaks (default "Something went
// wrong"). Chrome is found as for recording, or set $CHROME_PATH.

import { launch, snapshotProfile, removeProfileCopy, findChrome } from '../src/browser.js';

const [profile, url, ...rest] = process.argv.slice(2);
const [w, h, dsf, runs] = rest.slice(0, 4).map(Number);
const text = rest[4] ?? 'Something went wrong';
if (!profile || !url || ![w, h, dsf, runs].every((n) => n > 0)) {
  console.error('usage: node scripts/crash-probe.mjs PROFILE URL WIDTH HEIGHT DSF RUNS [TEXT]');
  process.exit(2);
}

const chrome = findChrome();
let crashed = 0;
for (let i = 0; i < runs; i++) {
  const dir = snapshotProfile(profile);
  const b = await launch({ chrome, width: w, height: h, dsf, userDataDir: dir, site: true });
  try {
    const p = (await b.pages())[0];
    await p.goto(url).catch(() => {});
    await new Promise((r) => setTimeout(r, 20000));
    if (await p.evaluate((t) => document.body.innerText.includes(t), text)) crashed++;
  } finally {
    await b.close();
    removeProfileCopy(dir);
  }
}
console.log(`${w}x${h}@${dsf}: crashed ${crashed}/${runs}`);
