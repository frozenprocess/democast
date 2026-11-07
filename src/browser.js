// Browsers for recording.
//
// The site runs in its own Chrome, as an ordinary top-level page in a
// window the size of the stage's browser panel, and its frames are painted
// live into the stage. To the site it's plain browsing: cookies are
// first-party, sign-in redirects across domains work, and sites that refuse
// to be framed (most apps behind a login) show normally.
//
// Logins are kept in Chrome profiles under ~/.config/democast/profiles.
// "democast login" opens a plain Chrome window on the profile (no
// automation attached, so Google, Microsoft and Meta sign-ins work) for
// signing in by hand; recordings then start from a copy of it.

import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, chmodSync, readFileSync, writeFileSync, readlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageRedactor } from './redact.js';
import { tempPath, release, trackBrowser } from './cleanup.js';

// findChrome returns the path of a Chrome/Chromium/Edge binary, or undefined.
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return candidates.find((p) => p && existsSync(p));
}

// requireChrome returns the Chrome to use: explicit (--chrome) if given,
// else the one found. It throws when there is none.
export function requireChrome(explicit) {
  const chrome = explicit ?? findChrome();
  if (!chrome) throw new Error('no Chrome found; pass --chrome or set CHROME_PATH');
  return chrome;
}

// firstPage is the browser's already-open page, or a new one.
export async function firstPage(browser) {
  return (await browser.pages())[0] ?? await browser.newPage();
}

// Chrome encrypts saved cookies with a key from the OS keyring, unless told
// to use a fixed one. Puppeteer passes these, so the login window must too,
// or cookies saved there can't be read when recording.
const KEY_STORE_FLAGS = ['--password-store=basic', '--use-mock-keychain'];

// Copying a profile skips caches and Chrome's lock files.
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'GraphiteDawnCache', 'DawnCache',
  'Crashpad', 'component_crx_cache', 'optimization_guide_model_store', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']);

function configDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'democast');
}

export function profileDir(name) {
  // No leading ".": "." and ".." would name the profiles folder or its parent.
  if (!/^\w[\w.-]*$/.test(name)) throw new Error(`profile names start with a letter, digit or "_" and may use "." and "-" after: ${JSON.stringify(name)}`);
  return path.join(configDir(), 'profiles', name);
}

// profileName returns the scene's profile name, or null for none.
export function profileName(scene) {
  const p = scene.browser?.profile;
  return p === true ? scene.name : p || null;
}

// snapshotProfile copies a saved profile to a temporary directory for one
// recording, so every take starts from the same signed-in state and a
// recording can't change the saved profile.
export function snapshotProfile(name) {
  const src = profileDir(name);
  if (!existsSync(src)) {
    throw new Error(`no saved browser profile "${name}"; run "democast login" first to sign in`);
  }
  if (profileLocked(src)) {
    throw new Error(`profile "${name}" is open in a Chrome window; close it before recording`);
  }
  const dst = tempPath(mkdtempSync(path.join(os.tmpdir(), 'democast-profile-')));
  cpSync(src, dst, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) });
  return dst;
}

// openProfile returns the saved profile itself, for a run that should
// keep what the site changes: Google rotates its session cookies as
// they're used, and a run that starts from a copy and throws the new ones
// away leaves the saved profile on cookies Google has retired, which signs
// it out. Google won't let an automated browser sign in again, so for a
// Google sign-in the profile has to stay current. Only one run at a time
// can use it.
export function openProfile(name) {
  const dir = profileDir(name);
  if (!existsSync(dir)) {
    throw new Error(`no saved browser profile "${name}"; run "democast login" first to sign in`);
  }
  if (profileLocked(dir)) {
    throw new Error(`profile "${name}" is open in a Chrome window; close it before recording`);
  }
  // Don't reopen the last run's tabs (the profile restores its session,
  // to keep session cookies). The cookies themselves stay.
  rmSync(path.join(dir, 'Default', 'Sessions'), { recursive: true, force: true });
  return dir;
}

// killOrphan stops pid if it's a headless Chrome a recording left behind
// when it was killed (its parent gone): a login window isn't headless, and
// a running recording's Chrome still has its node parent. Linux only.
function killOrphan(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const ppid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[1]);
    const parent = readFileSync(`/proc/${ppid}/comm`, 'utf8').trim();
    if (!cmd.includes('--headless') || parent === 'node') return false;
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

// profileLocked: whether a Chrome is using dir. A lock left by a Chrome
// that was killed (on this machine) is removed.
function profileLocked(dir) {
  const lock = path.join(dir, 'SingletonLock');
  let target;
  try {
    target = readlinkSync(lock);
  } catch {
    return existsSync(lock);
  }
  const m = target.match(/^(.*)-(\d+)$/);
  if (!m || m[1] !== os.hostname()) return true;
  const pid = Number(m[2]);
  try {
    process.kill(pid, 0);
    if (!killOrphan(pid)) return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
  }
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(path.join(dir, f), { force: true });
  return false;
}

export function removeProfileCopy(dir) {
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
  release(dir);
}

// prepareLoginProfile creates the profile directory and turns on "continue
// where you left off". Many sites sign in with session cookies (no expiry
// date), which Chrome otherwise discards when the window is closed.
export function prepareLoginProfile(dir) {
  mkdirSync(path.join(dir, 'Default'), { recursive: true });
  chmodSync(dir, 0o700);
  const file = path.join(dir, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  prefs.session = { ...prefs.session, restore_on_startup: 1 };
  writeFileSync(file, JSON.stringify(prefs));
}

// checkLoginUrls throws unless every URL is http(s). They are passed to
// Chrome as arguments, where anything starting with "--" would be a flag
// (--renderer-cmd-prefix runs a command), and a file: or javascript: URL
// has no business in a sign-in window.
export function checkLoginUrls(urls) {
  for (const u of urls) {
    let ok = false;
    try {
      ok = /^https?:$/.test(new URL(u).protocol);
    } catch {}
    if (!ok) throw new Error(`browser.loginUrl and site must be http(s) URLs to sign in to, got ${JSON.stringify(u)}`);
  }
}

// login opens a plain Chrome window on the profile and waits for it to be
// closed.
export async function login({ chrome, name, urls }) {
  checkLoginUrls(urls);
  const dir = profileDir(name);
  prepareLoginProfile(dir);
  const args = [
    `--user-data-dir=${dir}`, ...KEY_STORE_FLAGS,
    '--no-first-run', '--no-default-browser-check', '--new-window', ...urls,
  ];
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('exit', resolve);
  });
  return dir;
}

function windowUserAgent(chrome) {
  let major = '0';
  try {
    major = execFileSync(chrome, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/(\d+)\./)?.[1] ?? major;
  } catch {}
  const platform = { darwin: 'Macintosh; Intel Mac OS X 10_15_7', win32: 'Windows NT 10.0; Win64; x64' }[process.platform] ?? 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// launch starts a Chrome whose page is width x height CSS pixels at the
// given device pixel ratio. The ratio is forced on the browser as well as
// emulated: Chrome's screencast only delivers device-resolution frames
// with a real device scale factor.
/**
 * @param {{ chrome: string, headed?: boolean, width: number, height: number, dsf?: number, userDataDir?: string, site?: boolean }} options
 */
export async function launch({ chrome, headed, width, height, dsf = 1, userDataDir, site = false }) {
  // Without a profile, use a temporary one here rather than Puppeteer's,
  // which it removes only when the browser is closed, not on Ctrl-C.
  const scratch = userDataDir ? null : tempPath(mkdtempSync(path.join(os.tmpdir(), 'democast-chrome-')));
  const browser = trackBrowser(await puppeteer.launch({
    executablePath: chrome,
    headless: !headed,
    args: [
      '--hide-scrollbars', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required',
      `--force-device-scale-factor=${dsf}`,
      // Extra flags, e.g. --enable-gpu: headless Chrome otherwise draws in
      // software, which can't keep up at 4K.
      ...(process.env.DEMOCAST_CHROME_ARGS?.split(/\s+/).filter(Boolean) ?? []),
      // Look like a normal browser to sites, so a saved login isn't treated
      // as a bot session.
      ...(site ? ['--disable-blink-features=AutomationControlled'] : []),
      // Headless Chrome calls itself HeadlessChrome, and Google treats a
      // signed-in session seen from it as signed out; use the UA the same
      // Chrome has in a window.
      ...(site && !headed ? [`--user-agent=${windowUserAgent(chrome)}`] : []),
    ],
    ignoreDefaultArgs: site ? ['--enable-automation'] : [],
    defaultViewport: { width, height, deviceScaleFactor: dsf },
    // runner.js handles signals; cleanup.js kills the browser on exit.
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    userDataDir: userDataDir ?? scratch,
  }).catch((err) => {
    if (scratch) removeProfileCopy(scratch);
    throw err;
  }));
  if (scratch) browser.process()?.once('exit', () => removeProfileCopy(scratch));
  return browser;
}

// originOf is the origin of a URL, or null if it has none.
function originOf(url) {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

// siteGuard decides which requests may carry the scene's credentials (basic
// auth, extra headers): only the site's own origin. A page pulls in
// analytics, CDNs and embeds, and redirects can lead anywhere; none of
// them should receive the demo account's password or API key. Without a
// known origin (a scene with no "site"), the first page loaded sets it.
export function siteGuard(site) {
  const origins = new Set();
  const first = site ? originOf(site) : null;
  if (first) origins.add(first);
  return {
    // seen records a request; the first document request fixes the origin
    // when the scene named none.
    seen(url, resourceType) {
      if (!origins.size && resourceType === 'Document') {
        const o = originOf(url);
        if (o) origins.add(o);
      }
    },
    allows: (url) => origins.has(originOf(url) ?? ''),
    allowsChallenge: (origin) => origins.has(origin),
  };
}

// withHeaders is a request's headers (CDP's {name, value} list) with extra
// ones added, replacing any of the same name.
export function withHeaders(request, extra) {
  const lower = new Set(Object.keys(extra).map((k) => k.toLowerCase()));
  const kept = Object.entries(request).filter(([k]) => !lower.has(k.toLowerCase()));
  return [...kept, ...Object.entries(extra)].map(([name, value]) => ({ name, value: String(value) }));
}

// setupSitePage adds HTTP auth, extra headers, blurring and redaction to
// the site's page. Auth and headers go only to the site's origin (site).
/**
 * @param {import('puppeteer-core').Page} page
 * @param {{ auth?: any, headers?: any, blur?: any, redact?: any, site?: string }} options
 */
export async function setupSitePage(page, { auth, headers, blur, redact, site }) {
  const extra = headers && Object.keys(headers).length ? headers : null;
  if (extra || auth) {
    const session = await page.createCDPSession();
    const guard = siteGuard(site);
    await session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }], handleAuthRequests: Boolean(auth) });
    session.on('Fetch.requestPaused', ({ requestId, request, resourceType }) => {
      guard.seen(request.url, resourceType);
      const params = extra && guard.allows(request.url) ? { requestId, headers: withHeaders(request.headers, extra) } : { requestId };
      session.send('Fetch.continueRequest', params).catch(() => {});
    });
    session.on('Fetch.authRequired', ({ requestId, authChallenge }) => {
      const ok = auth && authChallenge.source !== 'Proxy' && guard.allowsChallenge(authChallenge.origin);
      session.send('Fetch.continueWithAuth', {
        requestId,
        authChallengeResponse: ok
          ? { response: 'ProvideCredentials', username: String(auth.username), password: String(auth.password) }
          : { response: 'CancelAuth' },
      }).catch(() => {});
    });
  }
  // Blurred elements are hidden from the first paint of every page the
  // site loads, not just after a step runs.
  if (blur?.length) {
    const css = `${blur.join(',\n')} { filter: blur(10px) !important; }`;
    await page.evaluateOnNewDocument((css) => {
      const add = () => {
        const s = document.createElement('style');
        s.dataset.democast = 'blur';
        s.textContent = css;
        (document.head || document.documentElement).append(s);
      };
      if (document.documentElement) add();
      else new MutationObserver((_, obs) => { if (document.documentElement) { obs.disconnect(); add(); } }).observe(document, { childList: true });
    }, css);
  }
  if (redact?.length) await page.evaluateOnNewDocument(pageRedactor, redact);
}

// mirror paints the site page's frames into the stage as they're produced,
// latest frame first: if the stage falls behind, older frames are dropped.
// With sink, each frame goes to sink(data, metadata) instead (democast
// --smooth keeps them all, to paint when it renders the take).
export async function mirror(sitePage, stagePage, sink) {
  const session = await sitePage.createCDPSession();
  let pending = null;
  let busy = false;
  let stopped = false;
  const pump = async () => {
    if (busy || stopped || !pending) return;
    busy = true;
    const data = pending;
    pending = null;
    await stagePage.evaluate((d) => window.stage.siteFrame(d), data).catch(() => {});
    busy = false;
    pump();
  };
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (sink) {
      if (!stopped) sink(data, metadata);
      return;
    }
    pending = data;
    pump();
  });
  // The stage's own capture compresses these frames again; at 98 the first
  // pass adds little loss (4 dB PSNR better than 92 on text) for 1-2%
  // more CPU, which counts most where remix and sources zoom into them.
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 98, everyNthFrame: 1 });
  return {
    async stop() {
      stopped = true;
      await session.send('Page.stopScreencast').catch(() => {});
    },
  };
}
