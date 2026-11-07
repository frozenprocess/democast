// Pure scene inspection shared by validation, recording and remixing.
// These helpers do not launch browsers or register process handlers.

// The steps a recorded scene can use. They are the keys of the registry in
// actions/index.js (test/scene.test.js checks they agree); listed here so
// loading a scene doesn't load every action.
export const ACTION_NAMES = [
  'wait', 'say', 'card', 'hideCard', 'caption', 'cursor.hide', 'focus', 'view',
  'browser.open', 'browser.waitFor', 'browser.click', 'browser.type', 'browser.fill', 'browser.press',
  'browser.waitQuiet', 'browser.highlight', 'browser.unhighlight', 'browser.scrollTo', 'browser.blur',
  'browser.unblur', 'browser.eval', 'browser.popup', 'browser.showPopup', 'browser.showMain', 'browser.capture',
  'term.type', 'term.print', 'term.clear', 'term.run', 'term.wait', 'term.waitFor', 'term.kill',
];

// The steps a remix scene (remix.js) can use.
export const REMIX_ACTIONS = ['clip', 'card', 'hideCard', 'caption', 'say', 'wait', 'cursor.hide'];

/** Return the action key of a validated scene step, ignoring its timeout. */
export function actionOf(/** @type {import('./types.js').Step} */ step) {
  return /** @type {string} */ (Object.keys(step).find((key) => key !== 'timeout'));
}

// panelOf returns the panel an action works on: "browser" for browser.*,
// "term" for term.*, else null (cards, captions, waits, ...).
export function panelOf(action) {
  if (action.startsWith('browser.')) return 'browser';
  if (action.startsWith('term.')) return 'term';
  return null;
}

// paneOf returns the terminal pane a term.* step uses: "term2" for
// pane: 2, else "term".
export function paneOf(arg) {
  const p = arg && typeof arg === 'object' && !Array.isArray(arg) ? arg.pane : undefined;
  if (p == null || p === 1) return 'term';
  if (p === 2) return 'term2';
  throw new Error(`pane must be 1 or 2, not ${JSON.stringify(p)}`);
}

// panelsFor reports which panels a scene uses.
/** @param {import('./types.js').Scene} scene */
export function panelsFor(scene) {
  const steps = [...(scene.setup ?? []), ...scene.steps];
  const actions = steps.map(actionOf);
  const term2 = Boolean(scene.terminal2) || steps.some((s, i) => panelOf(actions[i]) === 'term' && paneOf(s[actions[i]]) === 'term2');
  return {
    browser: Boolean(scene.site) || actions.some((a) => panelOf(a) === 'browser'),
    term: actions.some((a) => panelOf(a) === 'term') || term2,
    term2,
  };
}

