// democast login, with a stand-in for Chrome: a script that records how it
// was started and exits, as if the window had been closed. Nothing opens.
// The profile goes to a private $XDG_CONFIG_HOME, never the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, statSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLoginProfile } from '../src/browser.js';
import { tmpDir } from './tmp.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const noFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? false : 'no ffmpeg';

// A project folder with a fake Chrome (writing its arguments, one per line,
// to chrome.args) and a scene.
function setup(sceneYaml) {
  const dir = tmpDir('login');
  const chrome = path.join(dir, 'chrome');
  writeFileSync(chrome, '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/chrome.args"\n');
  chmodSync(chrome, 0o755);
  const scene = path.join(dir, 'app.yaml');
  writeFileSync(scene, sceneYaml);
  const config = path.join(dir, 'config');
  const login = (...flags) => spawnSync(process.execPath, [CLI, 'login', ...flags, scene], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, XDG_CONFIG_HOME: config },
  });
  const profiles = path.join(config, 'democast', 'profiles');
  const args = () => (existsSync(path.join(dir, 'chrome.args')) ? readFileSync(path.join(dir, 'chrome.args'), 'utf8').trim().split('\n') : null);
  return { dir, chrome, login, profiles, args };
}

test('login: opens Chrome on the scene\'s profile at its site, then reports it saved', { skip: noFfmpeg }, () => {
  const t = setup('site: https://example.test/app\nbrowser:\n  profile: work\nsteps:\n  - caption: hi\n');
  const r = t.login('--chrome', t.chrome);
  assert.equal(r.status, 0, r.stderr);
  const profile = path.join(t.profiles, 'work');
  assert.match(r.stdout, new RegExp(`Opening Chrome on profile "work" \\(${profile}\\)`));
  assert.match(r.stdout, /Sign in to example\.test, then close the window\./);
  assert.match(r.stdout, /Saved\. Recordings of this scene start from this signed-in profile\./);
  // The scene already names the profile, so no hint to add it.
  assert.doesNotMatch(r.stdout, /add to the scene/);

  const args = t.args();
  assert.ok(args.includes(`--user-data-dir=${profile}`), args.join(' '));
  // The key store flags must match the ones recordings use, or the cookies
  // saved here can't be read there.
  assert.ok(args.includes('--password-store=basic') && args.includes('--use-mock-keychain'));
  assert.ok(args.includes('--new-window') && args.includes('https://example.test/app'));
  // A plain window: no automation attached (Google and Microsoft refuse
  // to sign in to one).
  assert.ok(!args.some((a) => a.startsWith('--remote-debugging')), args.join(' '));
  assert.equal(statSync(profile).mode & 0o777, 0o700, 'only the user can read the saved login');
});

test('login: a scene without a profile gets the name of the scene, and a hint to use it', { skip: noFfmpeg }, () => {
  const t = setup('site: https://example.test/\nsteps:\n  - caption: hi\n');
  const r = t.login('--chrome', t.chrome);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(t.profiles, 'app')), 'named after the scene file');
  assert.match(r.stdout, /To use this login when recording, add to the scene:\n {2}browser:\n {4}profile: app/);
});

test('login: --profile names the profile, and loginUrl lists the windows to open', { skip: noFfmpeg }, () => {
  const t = setup('site: https://example.test/\nbrowser:\n  loginUrl: [https://a.test/, https://b.test/login]\nsteps:\n  - caption: hi\n');
  const r = t.login('--chrome', t.chrome, '--profile', 'other');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(t.profiles, 'other')));
  assert.match(r.stdout, /Sign in to a\.test and b\.test, then close the window\./);
  const args = t.args();
  assert.ok(args.includes('https://a.test/') && args.includes('https://b.test/login'));
  assert.ok(!args.includes('https://example.test/'), 'loginUrl replaces the site');
});

test('login: a scene with nowhere to sign in is refused before Chrome starts', { skip: noFfmpeg }, () => {
  const t = setup('steps:\n  - term.run: "echo hi"\n');
  const r = t.login('--chrome', t.chrome);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: the scene has no "site" or "browser.loginUrl" to sign in to/);
  assert.equal(t.args(), null, 'Chrome was not started');
  assert.equal(existsSync(t.profiles), false);
});

test('login: a sign-in URL that is not http(s) is refused before Chrome starts', { skip: noFfmpeg }, () => {
  const t = setup('browser:\n  loginUrl: ["--renderer-cmd-prefix=touch /tmp/pwned"]\nsteps:\n  - caption: hi\n');
  const r = t.login('--chrome', t.chrome);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: browser\.loginUrl and site must be http\(s\) URLs/);
  assert.equal(t.args(), null, 'Chrome was not started');
});

test('login: a Chrome that cannot start is reported', { skip: noFfmpeg }, () => {
  const t = setup('site: https://example.test/\nsteps:\n  - caption: hi\n');
  const r = t.login('--chrome', path.join(t.dir, 'no-such-chrome'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^democast: starting Chrome: .*ENOENT/);
});

test('prepareLoginProfile: restores the last session, keeping the rest of the preferences', () => {
  const dir = path.join(tmpDir('login'), 'profile');
  mkdirSync(path.join(dir, 'Default'), { recursive: true });
  writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ intl: { accept_languages: 'fr' }, session: { keep: true } }));
  prepareLoginProfile(dir);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8')), {
    intl: { accept_languages: 'fr' }, session: { keep: true, restore_on_startup: 1 },
  });
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('prepareLoginProfile: makes a new profile, and survives preferences that are not JSON', () => {
  const dir = path.join(tmpDir('login'), 'fresh');
  prepareLoginProfile(dir);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8')), { session: { restore_on_startup: 1 } });
  writeFileSync(path.join(dir, 'Default', 'Preferences'), '{ not json');
  prepareLoginProfile(dir);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8')), { session: { restore_on_startup: 1 } });
});
