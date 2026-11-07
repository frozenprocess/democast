// Commands a scene runs, and stopping them.

import os from 'node:os';
import { stopBrowsers } from './cleanup.js';

// Commands run in their own process group, so stopping one stops all of
// it: the shell, and every program in a pipeline it started. Signaling
// only the shell would leave the rest running.
export const running = new Set();
export function stopProc(proc, signal = 'SIGTERM') {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    process.kill(-proc.pid, signal);
  } catch {
    proc.kill(signal);
  }
}
// The groups don't get the terminal's Ctrl-C, so pass it on, and stop
// whatever is left when democast exits for any reason. Exiting skips the
// run's finally blocks; cleanup.js removes its temporary files.
process.on('exit', () => { for (const p of running) stopProc(p); });
// On a signal: pass it on to the commands, let Chrome quit (so it can clear
// its own scratch folders), then exit. A second signal doesn't wait: the
// exit handlers still kill what is left and remove the temporary files.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => {
    const status = 128 + os.constants.signals[sig];
    if (stopping) process.exit(status);
    stopping = true;
    for (const p of running) stopProc(p, sig === 'SIGHUP' ? 'SIGTERM' : sig);
    await stopBrowsers();
    process.exit(status);
  });
}
