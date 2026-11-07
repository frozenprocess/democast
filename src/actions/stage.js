// Stage actions: cards, captions, narration, waits and the layout. Each
// runs with this set to the run's Context (runner.js).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sayText } from '../tts.js';
import { sleep } from '../util.js';
import { CARD_FADE, VOICE_GAP } from '../timing.js';
import { TITLE_BAR } from '../formats.js';


export const STAGE_ACTIONS = {
  async wait(ms) { await sleep(Number(ms)); },

  // say plays a narration clip from this point in the video. By default
  // the scene waits for the clip to finish; with wait: false, the next
  // steps run while it plays. A clip never starts until the previous one
  // has finished, so lines don't talk over each other.
  async say(arg, _opts, step) {
    const clip = this.clips?.get(step);
    if (!clip) return;
    await sleep(this.voiceFreeAt - Date.now());
    this.narration.push({ file: clip.file, text: sayText(arg), start: (Date.now() - this.t0) / 1000, duration: clip.duration });
    this.voiceFreeAt = Date.now() + clip.duration * 1000 + VOICE_GAP;
    if (arg.wait !== false) await sleep(this.voiceFreeAt - Date.now());
  },

  async card(c) {
    c = this.interp(c);
    // Inline local images: a stage served from the site's origin can't
    // load file: URLs.
    if (c.image && !/^[a-z]+:/.test(c.image)) {
      const file = path.resolve(this.sceneDir, c.image);
      const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      c.image = `data:${type};base64,${readFileSync(file).toString('base64')}`;
    }
    await this.stage('card', c);
    this.cardShownAt = Date.now();
  },
  async hideCard(arg) {
    const min = arg?.minShown ?? 0;
    await sleep(Math.max(0, min - (Date.now() - this.cardShownAt)));
    await this.stage('hideCard');
    await sleep(CARD_FADE);
  },
  async caption(c) {
    c = this.interp(c);
    if (c == null || typeof c === 'string') c = { text: c ?? '' };
    await this.stage('caption', c.text, c.sub);
  },
  async 'cursor.hide'() { await this.stage('hideCursor'); },
  async focus(panel) {
    if (panel !== 'browser' && panel !== 'term') throw new Error('want browser or term');
    await this.stage('focus', panel);
  },
  async view(which) {
    if (!['browser', 'term', 'both'].includes(which)) throw new Error('view: want browser, term or both');
    const v = this.cfg.views?.[which];
    if (!v) throw new Error('view needs a side-by-side layout with a browser and one terminal (not 9x16, not pane: 2)');
    // Give the site the new panel's size, so it lays itself out for it
    // instead of being stretched.
    if (v.browser && this.site.page) {
      const zoom = this.cfg.browser.scale;
      const vp = this.site.page.viewport() ?? {};
      await this.site.page.setViewport({
        ...vp,
        width: Math.round(v.browser.w / zoom),
        height: Math.round((v.browser.h - TITLE_BAR) / zoom),
        deviceScaleFactor: this.siteDsf(v.browser.w),
      }).catch(() => {});
    }
    await this.stage('view', which);
  },
};
