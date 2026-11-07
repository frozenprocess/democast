// democast login: sign in to the scene's site, saving the session.

import { login as openLogin, profileName, profileDir, checkLoginUrls } from '../browser.js';
import { chromeFor, fail } from './common.js';

export async function login({ flags, scene }) {
  const chrome = chromeFor(flags);
  const name = flags.profile ?? profileName(scene) ?? scene.name;
  const urls = [].concat(scene.browser?.loginUrl ?? scene.site ?? []);
  if (!urls.length) fail('the scene has no "site" or "browser.loginUrl" to sign in to');
  try {
    checkLoginUrls(urls);
  } catch (err) {
    fail(err.message);
  }
  console.log(`Opening Chrome on profile "${name}" (${profileDir(name)}).`);
  console.log(`Sign in to ${urls.map((u) => new URL(u).host).join(' and ')}, then close the window.`);
  if (!profileName(scene)) {
    console.log(`To use this login when recording, add to the scene:\n  browser:\n    profile: ${name}`);
  }
  try {
    await openLogin({ chrome, name, urls });
  } catch (err) {
    return fail(`starting Chrome: ${err.message}`);
  }
  console.log('Saved. Recordings of this scene start from this signed-in profile.');
  return 0;
}
