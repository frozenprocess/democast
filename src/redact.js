// Redaction: hiding emails, network names, addresses and keys that a real
// signed-in session or a real command shows.
//
// A scene lists what to hide under "redact". In the terminal (and the fake
// URL bar), matches are replaced with a stand-in such as you@example.com.
// In the site, matches are blurred where they're drawn, using the CSS
// Custom Highlight API, which styles text without changing the page's DOM,
// so apps (React, code editors) don't notice and can't undo it.

// PRESETS are the common cases, by name. "partial" is a looser pattern used
// in the site, which also catches a match still being typed or streamed in
// (an AI's answer arriving a few characters at a time).
export const PRESETS = {
  email: { regex: String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`, partial: String.raw`[\w.+-]+@[\w.-]*`, with: 'you@example.com' },
  // A tailnet's DNS name: tailXXXX.ts.net, or a "fun name" like
  // happy-otter.ts.net (two words; while typed, once ".ts." follows: a
  // file name such as user-service.ts looks just like it up to there).
  tailnet: {
    regex: String.raw`\b(?:tail[0-9a-f]{4,}|[a-z]+-[a-z]+)\.ts\.net\b`,
    partial: String.raw`\btail[0-9a-f]{4,}(?:\.ts\.net|\.ts\.ne?|\.ts?|\.)?|\b[a-z]+-[a-z]+\.ts\.(?:net?\b|n\b|\B)`,
    with: 'tailXXXX.ts.net',
  },
  'tailscale-ip': { regex: String.raw`\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b`, with: '100.x.y.z' },
  'tailscale-ipv6': { regex: String.raw`\bfd7a:115c:a1e0(?::[0-9a-f]{0,4}){1,5}`, with: 'fd7a:115c:a1e0::x' },
  keys: { regex: String.raw`\b(?:tskey-[\w-]+|(?:nodekey|mkey|discokey|privkey):[0-9a-f]{16,})`, with: '[key]' },
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// checkRedact validates a scene's redact list, throwing a message fit for
// the user.
export function checkRedact(list) {
  if (!Array.isArray(list)) throw new Error('"redact" must be a list');
  list.forEach((r, i) => {
    if (typeof r === 'string') {
      if (!PRESETS[r]) throw new Error(`redact ${i}: unknown preset ${JSON.stringify(r)}; known: ${Object.keys(PRESETS).join(', ')}`);
    } else if (!r || typeof r !== 'object' || (r.text == null) === (r.regex == null)) {
      throw new Error(`redact ${i}: want a preset name, {text, with} or {regex, with}`);
    } else if (r.regex != null) {
      new RegExp(r.regex); // throws on a bad pattern
    }
  });
}

// redactRules turns a scene's redact list into rules: {source, flags, with,
// partial, literal}.
// interp expands {{env.NAME}}, so a real email can stay out of the scene.
// Entries that expand to an empty string are dropped.
export function redactRules(list = [], interp = (s) => s) {
  const rules = [];
  for (const r of list) {
    const e = typeof r === 'string' ? PRESETS[r] : r;
    const source = e.regex != null ? interp(e.regex) : escape(interp(String(e.text)));
    if (!source) continue;
    rules.push({
      source,
      flags: e.ignoreCase === false ? 'g' : 'gi',
      with: e.with != null ? interp(String(e.with)) : null,
      partial: e.partial ?? null,
      literal: e.regex == null ? interp(String(e.text)) : null,
    });
  }
  return rules;
}

// redactText replaces every match in s. A rule without "with" becomes
// block characters of the same length.
export function redactText(rules, s) {
  for (const r of rules) {
    s = s.replace(new RegExp(r.source, r.flags), (m) => r.with ?? '█'.repeat(m.length));
  }
  return s;
}

// STAGE_TEXT lists the stage calls that draw text, which can hold captured
// values ({{var}}), and which of their arguments do.
const STAGE_TEXT = { print: [0], type: [0], setUrl: [0], caption: [0, 1], card: [0] };
const CARD_TEXT = ['title', 'sub', 'link', 'pills', 'footer'];

// redactStageArgs redacts the text in the arguments of a stage call (see
// Context.stage), returning new arguments.
export function redactStageArgs(rules, fn, args) {
  const at = STAGE_TEXT[fn];
  if (!rules.length || !at) return args;
  const text = (v) => (typeof v === 'string' ? redactText(rules, v) : Array.isArray(v) ? v.map(text) : v);
  return args.map((a, i) => {
    if (!at.includes(i)) return a;
    if (fn !== 'card' || !a || typeof a !== 'object') return text(a);
    return { ...a, ...Object.fromEntries(CARD_TEXT.filter((k) => a[k] != null).map((k) => [k, text(a[k])])) };
  });
}

// lineBuffer redacts a stream of output chunks. A match can be split across
// chunks, so it holds back an unfinished line for a moment before printing
// it.
export function lineBuffer(rules, print, holdMs = 120) {
  let pending = '';
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (pending) print(redactText(rules, pending));
    pending = '';
  };
  return {
    write(chunk) {
      pending += chunk;
      const nl = pending.lastIndexOf('\n');
      if (nl >= 0) {
        print(redactText(rules, pending.slice(0, nl + 1)));
        pending = pending.slice(nl + 1);
      }
      clearTimeout(timer);
      timer = pending ? setTimeout(flush, holdMs) : null;
    },
    flush,
  };
}

// pageRedactor runs in the site's pages, from the first paint: it blurs
// every match of the rules in the page's text, and keeps doing so as the
// page changes. Matches are found within one text node. Text that ends a
// node with the start of a literal (4 characters or more) is blurred too,
// since the rest may be on its way.
export function pageRedactor(rules) {
  if (!window.CSS?.highlights) return;
  const res = rules.map((r) => new RegExp(r.partial ?? r.source, r.flags));
  const lits = rules.filter((r) => r.literal).map((r) => r.literal.toLowerCase());
  const hl = new Highlight();
  CSS.highlights.set('democast-redact', hl);
  const style = () => {
    const s = document.createElement('style');
    s.dataset.democast = 'redact';
    s.textContent = '::highlight(democast-redact) { color: transparent; text-shadow: 0 0 10px #8a8f98; }\n' +
      '[data-democast-redact] { filter: blur(8px) !important; }';
    (document.head || document.documentElement).append(s);
  };
  // scan joins the page's text into runs, so a value split across inline
  // elements (an address in two spans, for truncation) still matches. A
  // run breaks at anything else, so a label and its value in separate
  // blocks stay apart.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'SMALL', 'MARK', 'SUB', 'SUP', 'ABBR', 'TIME', 'LABEL', 'U', 'S', 'KBD', 'SAMP', 'VAR', 'BDI', 'BDO', 'DATA', 'Q', 'CITE']);
  // inlineRoot is the outermost element reached from n through inline
  // elements only.
  const inlineRoot = (n) => {
    let e = n.parentElement;
    while (e && INLINE.has(e.tagName) && e.parentElement && INLINE.has(e.parentElement.tagName)) e = e.parentElement;
    return INLINE.has(e?.tagName) ? e : n.parentElement;
  };
  const near = (a, b) => {
    const ra = inlineRoot(a), rb = inlineRoot(b);
    return ra === rb || ra.parentElement === rb || rb.parentElement === ra || (INLINE.has(ra.tagName) && INLINE.has(rb.tagName) && ra.parentElement === rb.parentElement);
  };
  const mark = (run, text, from, to) => {
    // run.starts[i] is where run.nodes[i] begins in text.
    let i = 0;
    while (i + 1 < run.nodes.length && run.starts[i + 1] <= from) i++;
    let j = i;
    while (j + 1 < run.nodes.length && run.starts[j + 1] < to) j++;
    const r = new Range();
    r.setStart(run.nodes[i], from - run.starts[i]);
    r.setEnd(run.nodes[j], to - run.starts[j]);
    hl.add(r);
  };
  const scanRun = (run) => {
    const text = run.text;
    if (text.length < 4) return;
    for (const re of res) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[0]) { re.lastIndex++; continue; }
        mark(run, text, m.index, m.index + m[0].length);
      }
    }
    // The start of a literal at the end of a node may be the rest of it
    // still arriving.
    run.nodes.forEach((n, i) => {
      const t = n.data.toLowerCase();
      for (const lit of lits) {
        for (let k = Math.min(lit.length - 1, t.length); k >= 4; k--) {
          if (t.endsWith(lit.slice(0, k))) {
            mark(run, text, run.starts[i] + t.length - k, run.starts[i] + t.length);
            break;
          }
        }
      }
    });
  };
  // collectRuns walks the page's text and groups it into runs.
  const collectRuns = () => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (SKIP.has(/** @type {string} */ (n.parentElement?.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    /** @type {{ nodes: Node[], starts: number[], text: string }[]} */
    const runs = [];
    /** @type {(typeof runs)[number] | null} */
    let run = null;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!run || !near(run.nodes[run.nodes.length - 1], n)) {
        run = { nodes: [], starts: [], text: '' };
        runs.push(run);
      }
      run.starts.push(run.text.length);
      run.nodes.push(n);
      run.text += /** @type {Text} */ (n).data;
    }
    return runs;
  };
  const scan = () => {
    hl.clear();
    if (!document.body) return;
    for (const run of collectRuns()) scanRun(run);
    // Form fields hold their text as a value, not in the page's text, so
    // they're checked separately and blurred whole.
    for (const el of document.querySelectorAll('input, textarea')) fieldCheck(el);
  };
  const fieldCheck = (el) => {
    if (el.type === 'password' || el.type === 'checkbox' || el.type === 'radio') return;
    const hit = res.some((re) => { re.lastIndex = 0; return re.test(el.value); });
    if (hit !== el.hasAttribute('data-democast-redact')) el.toggleAttribute('data-democast-redact', hit);
  };
  // Typing changes a field's value without changing the page.
  document.addEventListener('input', (e) => { if (/** @type {Element} */ (e.target).matches?.('input, textarea')) fieldCheck(e.target); }, true);
  // Mutation callbacks run before the next paint, so new text is never
  // drawn unblurred.
  let queued = false;
  const obs = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; scan(); });
  });
  const start = () => {
    style();
    scan();
    obs.observe(document, { childList: true, subtree: true, characterData: true });
  };
  if (document.documentElement) start();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
}
