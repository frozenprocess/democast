// One registry for step dispatch and scene validation.
import { STAGE_ACTIONS } from './stage.js';
import { BROWSER_ACTIONS } from './browser.js';
import { TERM_ACTIONS } from './term.js';

export const ACTIONS = { ...STAGE_ACTIONS, ...BROWSER_ACTIONS, ...TERM_ACTIONS };
