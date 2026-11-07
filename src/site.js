// The site: the page a scene's browser actions drive, mirrored onto the
// stage. A popup can take its place on the stage (browser.showPopup) and
// give it back (browser.showMain).

import { mirror } from './browser.js';
import { sleep } from './util.js';

const SETTLE_AFTER_SCROLL = 900; // let a scroll finish before the next step

export class Site {
  // ctx is the run's Context: the stage it draws on, the step timeout.
  constructor(ctx) {
    this.ctx = ctx;
    // The site page now on the stage (a popup, after browser.showPopup),
    // the site's original page, and the mirror copying the shown page to
    // the stage.
    this.page = null;
    this.mainPage = null;
    this.mirror = null;
    // A label the scene fixes for the URL bar, instead of the real address.
    this.urlLabel = null;
  }

  // use sets the site's page, which is also its main page.
  use(page) {
    this.page = page;
    this.mainPage = page;
  }

  // show puts page on the stage, in place of any page shown before.
  async show(page) {
    await this.mirror?.stop();
    this.mirror = await mirror(page, this.ctx.page, this.ctx.siteSink);
  }

  // stop ends the mirror.
  async stop() {
    await this.mirror?.stop();
  }

  async frame() {
    if (!this.page) throw new Error('the scene has no browser panel; set "site" or use browser.open');
    return this.page.mainFrame();
  }

  // open loads url in the site's browser, waiting until its document has
  // loaded. label, if given, is shown in the URL bar from then on instead
  // of the real address.
  async open(url, label) {
    this.urlLabel = label || null;
    await this.ctx.stage('setUrl', label || url);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.ctx.timeout });
  }

  // scrollIntoView smoothly scrolls the site so sel is comfortably visible.
  async scrollIntoView(sel, { force = false } = {}) {
    const f = await this.frame();
    const moved = await f.$eval(sel, (el, force) => {
      const r = el.getBoundingClientRect();
      if (!force && r.top >= 0 && r.bottom <= innerHeight) return false;
      // An element inside a scrolling box (a dialog, a side panel) needs
      // that box scrolled, not the page.
      const before = scrollY;
      window.scrollTo({ top: r.top + scrollY - innerHeight * 0.25, behavior: 'instant' });
      const r2 = el.getBoundingClientRect();
      window.scrollTo({ top: before, behavior: 'instant' });
      if (r2.top >= 0 && r2.bottom <= innerHeight) {
        window.scrollTo({ top: r.top + scrollY - innerHeight * 0.25, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return true;
    }, force);
    if (moved) await sleep(SETTLE_AFTER_SCROLL);
  }

  // pointAt moves the pointer to sel and returns the site's frame and the
  // point aimed at, in the site's coordinates.
  async pointAt(sel, timeout) {
    const f = await this.frame();
    await f.waitForSelector(sel, { visible: true, timeout });
    await this.scrollIntoView(sel);
    const site = await this.ctx.stage('siteRect');
    // CSS px on the site to px on the stage (the panel's width can change
    // with view: steps; its zoom doesn't).
    const s = site.w / (await this.page.evaluate(() => window.innerWidth));
    const r = await f.$eval(sel, (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    });
    // Aim a little left of center on wide elements, as a person would.
    const at = { x: r.x + Math.min(r.w / 2, 120), y: r.y + r.h / 2 };
    await this.ctx.stage('moveTo', site.x + at.x * s, site.y + at.y * s);
    return { f, ...at };
  }

  // clickAt clicks the site where the pointer is, as a real mouse would.
  async clickAt(sel, timeout) {
    const p = await this.pointAt(sel, timeout);
    await this.ctx.stage('clickFx');
    await this.page.mouse.click(p.x, p.y);
    return p;
  }
}
