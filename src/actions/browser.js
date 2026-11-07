// Browser actions: the site's page, driven as a person would. Each runs
// with this set to the run's Context (runner.js).

import { setupSitePage } from '../browser.js';
import { rhythm } from '../termhtml.js';
import { sleep } from '../util.js';

// Pauses and limits (ms) that pace the site's actions like a person.
const AFTER_TYPING = 300;
const AFTER_FILL = 500;
const BETWEEN_KEYS = 120;
const AFTER_PRESS = 200;
const AFTER_SCROLL = 900; // smooth scrolling to a highlight
const POLL = 250; // popup and element polling
const POPUP_CALL_CAP = 3000; // one hung call counts as a miss
const RECLICK_AFTER = 6000; // trigger clicked, no popup yet
const TRIGGER_SEEN = 1500; // a newly shown button, finishing its animation
const POPUP_LOAD = 1000; // let a loading popup wire up its handlers
const AFTER_SHOW_POPUP = 500;

// pressKeys presses a key or a combination such as "Control+Enter".
async function pressKeys(keyboard, combo) {
  const keys = String(combo).split('+');
  const key = keys.pop();
  for (const m of keys) await keyboard.down(m);
  await keyboard.press(key);
  for (const m of keys.reverse()) await keyboard.up(m);
}

// selectContents selects all of an input's or editable element's text, so
// typing replaces it.
async function selectContents(f, sel) {
  await f.$eval(sel, (el) => {
    if ('select' in el && typeof el.select === 'function') return el.select();
    const target = el.isContentEditable ? el : el.querySelector('[contenteditable=""],[contenteditable=true]') ?? el;
    const r = document.createRange();
    r.selectNodeContents(target);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
  });
}

// markText runs in the page: it highlights the first visible passage
// matching text, within scope (a selector) if given, and returns its top
// edge as {top}, or null if it isn't there (yet).
function markText(text, color, scope) {
  const norm = (s) => s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').toLowerCase();
  const want = norm(text).trim();
  // Join the page's text nodes, normalized, remembering where each
  // character came from.
  let all = '';
  /** @type {[Node, number][]} */
  const from = [];
  const root = scope ? document.querySelector(scope) : document.body;
  if (!root) return null;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = /** @type {Text} */ (n);
    const p = text.parentElement;
    if (!p || p.closest('script,style,noscript') || !p.getClientRects().length) continue;
    for (let i = 0; i < text.data.length; i++) {
      const c = norm(text.data[i]);
      if (c === ' ' && all.endsWith(' ')) continue;
      all += c;
      from.push([n, i]);
    }
  }
  const at = all.indexOf(want);
  if (at < 0) {
    // Code editors draw only the lines on screen. If one holds the text,
    // scroll it there; the next try finds it.
    for (const el of document.querySelectorAll('.CodeMirror')) {
      const cm = /** @type {any} */ (el).CodeMirror;
      if (!cm) continue;
      const head = want.slice(0, 40).trim();
      const line = cm.getValue().split('\n').findIndex((l) => norm(l).includes(head));
      if (line >= 0) cm.scrollIntoView({ line, ch: 0 }, 120);
    }
    return null;
  }
  const [sn, so] = from[at];
  const [en, eo] = from[at + want.length - 1];
  const r = new Range();
  r.setStart(sn, so);
  r.setEnd(en, eo + 1);
  if (!document.querySelector('style[data-democast=mark]')) {
    const s = document.createElement('style');
    s.dataset.democast = 'mark';
    s.textContent = `::highlight(democast-mark) { background-color: ${color}; }`;
    document.head.append(s);
  }
  CSS.highlights.set('democast-mark', new Highlight(r));
  return { top: r.getBoundingClientRect().top };
}

export const BROWSER_ACTIONS = {
  async 'browser.open'(arg) {
    const a = typeof arg === 'string' ? { url: arg } : arg;
    await this.site.open(this.interp(a.url), this.interp(a.label));
  },
  // browser.waitFor waits for a condition. With reload: N, a page that
  // isn't ready within each: ms (default 30000) is reloaded, up to N
  // times, for apps that sometimes come up broken.
  async 'browser.waitFor'(arg, { timeout }) {
    arg = this.interp(arg);
    if (typeof arg === 'string') arg = { js: arg };
    const wait = async (f, ms) => {
      if (arg.selector) await f.waitForSelector(arg.selector, { visible: true, timeout: ms });
      else if (arg.text) await f.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms, polling: 100 }, arg.text);
      else if (arg.js) await f.waitForFunction(arg.js, { timeout: ms, polling: 100 });
      else throw new Error('want a JS expression string, or {selector}, {text} or {js}');
    };
    const reloads = arg.reload ?? 0;
    for (let n = 0; ; n++) {
      try {
        return await wait(await this.site.frame(), reloads ? (arg.each ?? 30000) : timeout);
      } catch (err) {
        if (n >= reloads || err.name !== 'TimeoutError') throw err;
        this.log(`    not ready; reloading (${n + 1}/${reloads})`);
        await this.site.page.reload({ waitUntil: 'domcontentloaded', timeout: this.timeout });
      }
    }
  },
  async 'browser.click'(arg, { timeout }) {
    await this.site.clickAt(this.interp(typeof arg === 'string' ? arg : arg.selector), timeout);
  },
  // browser.type clicks a field and types into it with real key presses,
  // so it works in rich editors and chat boxes as well as plain inputs.
  // "\n" presses Enter. The pause between keys varies like a person's;
  // with seed, the same way on every take.
  async 'browser.type'(arg, { timeout }) {
    const { selector, text, cps = 18, clear = false, seed } = this.interp(arg);
    const rand = seed == null ? Math.random : rhythm(seed);
    // Without a selector, type where the focus is, e.g. a code editor
    // after browser.eval placed its cursor.
    if (selector) {
      const { f } = await this.site.clickAt(selector, timeout);
      if (clear) await selectContents(f, selector);
    }
    const kb = this.site.page.keyboard;
    for (const ch of text) {
      if (ch === '\n') await kb.press('Enter');
      else await kb.sendCharacter(ch);
      await sleep(1000 / cps * (0.6 + rand() * 0.8));
    }
    await sleep(AFTER_TYPING);
  },
  // browser.fill replaces a field's contents at once, like a paste.
  async 'browser.fill'(arg, { timeout }) {
    const { selector, text } = this.interp(arg);
    const { f } = await this.site.clickAt(selector, timeout);
    await selectContents(f, selector);
    await this.site.page.keyboard.sendCharacter(text);
    await sleep(AFTER_FILL);
  },
  async 'browser.press'(arg) {
    const a = typeof arg === 'object' && arg ? arg : { key: arg };
    for (let n = 0; n < (a.times ?? 1); n++) {
      await pressKeys(this.site.page.keyboard, a.key);
      await sleep(BETWEEN_KEYS);
    }
    await sleep(AFTER_PRESS);
  },
  // browser.waitQuiet waits until the page's text (or an element's) has
  // stopped changing for ms, e.g. until an AI's answer finishes streaming.
  async 'browser.waitQuiet'(arg, { timeout }) {
    const a = typeof arg === 'number' ? { ms: arg } : { ...this.interp(arg ?? {}) };
    const f = await this.site.frame();
    await f.waitForFunction((sel, ms) => {
      const el = sel ? document.querySelector(sel) : document.body;
      const t = el ? el.innerText : '';
      const w = (window.__democastQuiet ??= { t: null, at: 0 });
      if (t !== w.t) { w.t = t; w.at = Date.now(); }
      return Date.now() - w.at >= ms;
    }, { timeout, polling: 200 }, a.selector ?? null, a.ms ?? 2500);
    await f.evaluate(() => { delete window.__democastQuiet; });
  },
  // browser.highlight marks a passage of text, like a highlighter pen, and
  // scrolls it into view. Quotes, apostrophes and spacing needn't match
  // exactly.
  async 'browser.highlight'(arg, { timeout }) {
    const a = typeof arg === 'string' ? { text: arg } : this.interp(arg);
    const f = await this.site.frame();
    const found = await f.waitForFunction(markText, { timeout, polling: POLL }, this.interp(a.text), a.color ?? 'rgba(255, 214, 10, 0.55)', a.selector ?? null);
    const { top } = await found.jsonValue();
    await f.evaluate((top) => window.scrollTo({ top: top + scrollY - innerHeight * 0.35, behavior: 'smooth' }), top);
    await sleep(AFTER_SCROLL);
  },
  async 'browser.unhighlight'() {
    await (await this.site.frame()).evaluate(() => CSS.highlights.delete('democast-mark'));
  },
  async 'browser.scrollTo'(arg, { timeout }) {
    const sel = this.interp(typeof arg === 'string' ? arg : arg.selector);
    const f = await this.site.frame();
    await f.waitForSelector(sel, { timeout });
    await this.site.scrollIntoView(sel, { force: true });
  },
  // browser.blur hides elements on the current page, e.g. an email address,
  // until browser.unblur. For elements that must never show, use the
  // scene's browser.blur setting, which applies from each page's first paint.
  async 'browser.blur'(arg) {
    if (this.scene.noBlur) return;
    const sels = [].concat(this.interp(typeof arg === 'object' && !Array.isArray(arg) ? arg.selector : arg));
    await (await this.site.frame()).evaluate((css) => {
      const s = document.createElement('style');
      s.dataset.democast = 'blur-step';
      s.textContent = css;
      document.head.append(s);
    }, `${sels.join(',')} { filter: blur(10px) !important; transition: filter .3s; }`);
  },
  async 'browser.unblur'() {
    await (await this.site.frame()).evaluate(() => document.querySelectorAll('style[data-democast="blur-step"]').forEach((s) => s.remove()));
  },
  async 'browser.eval'(js) {
    await (await this.site.frame()).evaluate(this.interp(js));
  },
  // browser.popup clicks selector in a window the site opened, such as an
  // OAuth sign-in popup. Popups aren't in the video, so this is off camera.
  // With url, only windows whose address contains it are searched.
  async 'browser.popup'(arg, { timeout }) {
    const a = typeof arg === 'string' ? { click: arg } : arg;
    const sel = this.interp(a.click);
    const url = a.url && this.interp(a.url);
    // unless: a selector that, showing in any popup, means this step isn't
    // needed (say, a sign-in the browser is already past).
    const unless = a.unless && this.interp(a.unless);
    // trigger: a selector on the site page that opens the popup. It's
    // clicked first, and again every few seconds while no popup has opened
    // and it's still there, for pages that lose a click (a dialog still
    // animating in).
    // A list of triggers is for a flow with several steps before the popup
    // (a dialog's button, then a permission prompt's): whichever is showing
    // is clicked, a newly shown one at once.
    const triggers = a.trigger ? [].concat(a.trigger).map((t) => this.interp(t)) : [];
    const browser = this.site.page.browser();
    const end = Date.now() + timeout;
    let clickedAt = 0;
    let clicked = null;
    // A popup that is navigating can leave calls hanging until the protocol
    // timeout, so each call gets a few seconds and a hang counts as a miss.
    const capped = (p, ms = POPUP_CALL_CAP) => Promise.race([p.catch(() => null), sleep(ms).then(() => null)]);
    for (;;) {
      const all = (await browser.pages()).filter((p) => p !== this.site.mainPage).reverse();
      if (triggers.length && !all.length) {
        const f = await this.site.frame();
        for (const trigger of triggers) {
          const t = await capped(f.$(trigger));
          if (!t || !(await capped(t.isVisible()))) continue;
          if (trigger === clicked && Date.now() - clickedAt < RECLICK_AFTER) break;
          if (trigger === clicked) this.log?.('    no popup yet; clicking again');
          // Let a newly shown button be seen (and finish animating in).
          else if (clicked) await sleep(TRIGGER_SEEN);
          await this.site.clickAt(trigger, 5000).catch(() => {});
          clicked = trigger;
          clickedAt = Date.now();
          break;
        }
      }
      if (unless) {
        for (const p of all) {
          const el = await capped(p.$(unless));
          if (el && await capped(el.isVisible())) {
            this.log?.(`    skipped: a popup already shows ${unless}`);
            return;
          }
        }
      }
      // Google won't sign in inside an automated browser; no use waiting.
      if (all.some((p) => p.url().includes('accounts.google.com/v3/signin/rejected'))) {
        throw new Error('Google refused to sign in inside the recording ("This browser or app may not be secure"); sign in with "democast login" instead, so the scene never has to');
      }
      const popups = all.filter((p) => !url || p.url().includes(url));
      for (const p of popups) {
        let el = await capped(p.$(sel));
        if (el && await capped(el.isVisible())) {
          // Let a page that is still loading wire up its handlers, then
          // look again, so the click isn't lost.
          await sleep(POPUP_LOAD);
          el = await capped(p.$(sel));
          if (!el) continue;
          // Mouse clicks only reach the window in front.
          await capped(p.bringToFront());
          // The click often navigates the popup, which can leave it
          // hanging; the element was there and visible, so count it done.
          await capped(el.click(), 5000);
          // A popup in front stops the site page from repainting, which
          // freezes the video on its last frame; bring the site back.
          await capped(this.site.mainPage.bringToFront());
          return;
        }
      }
      if (Date.now() > end) {
        const seen = await Promise.all(popups.map(async (p) => `${p.url()}: ${((await capped(p.evaluate(() => document.body?.innerText ?? ''))) ?? '').replace(/\s+/g, ' ').slice(0, 300)}`));
        throw new Error(`no popup window showed ${sel} within ${timeout}ms; popups: ${seen.join(' | ') || 'none'}`);
      }
      await sleep(POLL);
    }
  },
  // browser.showPopup puts a popup window (a sign-in, say) in the browser
  // panel, so the steps after it are filmed and act on the popup. When the
  // popup closes, or at browser.showMain, the panel goes back to the site.
  async 'browser.showPopup'(arg, { timeout }) {
    const a = typeof arg === 'string' ? { url: arg } : (arg ?? {});
    const url = a.url && this.interp(a.url);
    const browser = this.site.mainPage.browser();
    const end = Date.now() + timeout;
    let popup;
    for (;;) {
      popup = (await browser.pages()).reverse().find((p) => p !== this.site.mainPage && p.url() !== 'about:blank' && (!url || p.url().includes(url)));
      if (popup) break;
      if (Date.now() > end) throw new Error(`no popup window${url ? ` at ${url}` : ''} within ${timeout}ms`);
      await sleep(POLL);
    }
    if (popup === this.site.page) return;
    // Lay the popup out at the panel's size, so it fills it like the site.
    const vp = this.site.mainPage.viewport();
    if (vp) await popup.setViewport(vp).catch(() => {});
    await setupSitePage(popup, { redact: this.redact }).catch(() => {});
    await popup.bringToFront();
    await this.site.show(popup);
    this.site.page = popup;
    await this.stage('setUrl', popup.url());
    popup.on('framenavigated', (f) => {
      if (this.site.page === popup && f === popup.mainFrame()) this.stage('setUrl', f.url()).catch(() => {});
    });
    popup.once('close', () => { if (this.site.page === popup) BROWSER_ACTIONS['browser.showMain'].call(this).catch(() => {}); });
    await sleep(AFTER_SHOW_POPUP);
  },
  async 'browser.showMain'() {
    if (this.site.page === this.site.mainPage) return;
    this.site.page = this.site.mainPage;
    await this.site.mainPage.bringToFront().catch(() => {});
    await this.site.show(this.site.mainPage);
    await this.stage('setUrl', this.site.urlLabel || this.site.mainPage.url());
  },
  async 'browser.capture'(arg, { timeout }) {
    const a = this.interp(arg);
    const f = await this.site.frame();
    let value;
    if (a.selector) {
      const h = await f.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        const v = el && (el.value || el.textContent || '').trim();
        return v || null;
      }, { timeout, polling: 100 }, a.selector);
      value = await h.jsonValue();
    } else if (a.js) {
      value = await (await f.waitForFunction(a.js, { timeout, polling: 100 })).jsonValue();
    } else {
      throw new Error('want {var, selector} or {var, js}');
    }
    if (a.regex) {
      const m = String(value).match(new RegExp(a.regex));
      if (!m) throw new Error(`captured value ${JSON.stringify(this.shown(value))} doesn't match ${a.regex}`);
      value = m[1] ?? m[0];
    }
    this.vars[a.var] = value;
    this.log(`    ${a.var} = ${this.shown(value)}`);
  },
};
