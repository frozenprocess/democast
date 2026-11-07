// Cleanup on exit: temporary files and browsers that a run's finally blocks
// would remove, but that a Ctrl-C (process.exit in the signal handler)
// would leave behind. A profile copy holds the session's cookies, so it
// mustn't stay in /tmp.

import { rmSync } from 'node:fs';

const paths = new Set();
const browsers = new Set();

// tempPath marks a file or directory to remove if democast exits before
// release(path).
export function tempPath(p) {
  paths.add(p);
  return p;
}

export function release(p) {
  paths.delete(p);
}

// trackBrowser kills the browser's process group if democast exits while
// it runs, before the files it may be writing (its profile) are removed.
export function trackBrowser(browser) {
  const proc = browser.process();
  if (!proc) return browser;
  browsers.add(proc);
  proc.once('exit', () => browsers.delete(proc));
  return browser;
}

// signalGroup sends signal to the browser's whole process group (its
// helper processes included), or to the browser alone if it has none.
function signalGroup(proc, signal) {
  try {
    process.kill(-proc.pid, signal);
  } catch {
    proc.kill(signal);
  }
}

// stopBrowsers asks every tracked browser to quit, so Chrome can remove the
// scratch folders it makes itself, and resolves once they have, or after
// graceMs. The request is SIGINT, not SIGTERM: Chrome shuts down cleanly on
// SIGINT (and removes its com.google.Chrome.* folder), but on SIGTERM it
// exits at once and leaves it. Anything still running is killed by the exit
// handler below. It needs the event loop (a browser's exit is an event), so
// it is for signal handlers; a plain exit can only kill.
export async function stopBrowsers(graceMs = 3000) {
  const procs = [...browsers];
  const exited = procs.map((p) => new Promise((resolve) => {
    if (p.exitCode !== null || p.signalCode !== null) resolve(undefined);
    else p.once('exit', () => resolve(undefined));
  }));
  for (const p of procs) signalGroup(p, 'SIGINT');
  let timer;
  await Promise.race([Promise.all(exited), new Promise((resolve) => { timer = setTimeout(resolve, graceMs); })]);
  clearTimeout(timer);
}

process.on('exit', () => {
  // Whatever is still running, whichever way democast is exiting.
  for (const proc of browsers) signalGroup(proc, 'SIGKILL');
  // Retries, since a just-killed Chrome can still hold files for a moment.
  for (const p of paths) rmSync(p, { recursive: true, force: true, maxRetries: 3 });
});
