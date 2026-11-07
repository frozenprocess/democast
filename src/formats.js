// Output formats and their stage layouts. Each layout has a "both" variant
// (browser and terminal) and a "single" rectangle used when the scene has
// only one panel; "max" replaces "single" for a scene with layout: max, and
// fills the frame (leaving no room for captions). A layout with "focus" shows one panel at a time in that
// rectangle instead of both, switching to whichever panel a step uses.
//
// "safe" is the area a platform's own UI covers (top, right, bottom, left
// margins, plus an extra-wide right "rail" of buttons from y down). Layouts
// keep content out of it, and --guides draws it.

// The height of the fake window's title bar (and URL bar), above a panel's
// content. stage.html draws it; layout code that needs the content's size
// subtracts it.
export const TITLE_BAR = 46;

// The vertical format's height, and where its button rail starts.
const VERTICAL_H = 1920;
const RAIL_Y = 840;

export const FORMATS = {
  // Landscape: LinkedIn, YouTube, X.
  '16x9': {
    w: 1920, h: 1080,
    caption: { top: 44, size: 46, sub: 24 },
    both: { browser: { x: 70, y: 190, w: 1020, h: 830 }, term: { x: 1130, y: 190, w: 720, h: 830 } },
    single: { x: 260, y: 190, w: 1400, h: 830 },
    max: { x: 40, y: 40, w: 1840, h: 1000 },
    scale: 1.2,
    termFont: 21,
  },
  // Square: feeds on LinkedIn, Instagram, X, Facebook.
  '1x1': {
    w: 1080, h: 1080,
    caption: { top: 30, size: 40, sub: 22 },
    both: { browser: { x: 40, y: 140, w: 1000, h: 580 }, term: { x: 40, y: 740, w: 1000, h: 310 } },
    single: { x: 40, y: 140, w: 1000, h: 910 },
    max: { x: 40, y: 40, w: 1000, h: 1000 },
    scale: 1.0,
    termFont: 18,
  },
  // Portrait: the largest a video gets in the Instagram, LinkedIn and
  // Facebook feeds.
  '4x5': {
    w: 1080, h: 1350,
    caption: { top: 40, size: 44, sub: 24 },
    both: { browser: { x: 40, y: 170, w: 1000, h: 760 }, term: { x: 40, y: 950, w: 1000, h: 360 } },
    single: { x: 40, y: 170, w: 1000, h: 1140 },
    max: { x: 40, y: 40, w: 1000, h: 1270 },
    scale: 1.1,
    termFont: 19,
  },
  // Vertical: TikTok, Instagram Reels, YouTube Shorts. Their UI covers a
  // lot of the frame, so everything stays inside the area all three leave
  // clear, and panels take turns at a size readable on a phone.
  '9x16': {
    w: 1080, h: VERTICAL_H,
    safe: { top: 288, right: 192, bottom: 672, left: 120, rail: { y: RAIL_Y, w: 300 } },
    caption: { top: 300, size: 50, sub: 27, left: 120, right: 192 },
    focus: { x: 100, y: 450, w: 800, h: 798 },
    single: { x: 100, y: 450, w: 800, h: 798 },
    // layout: both stacks the two panels in the same band as focus/single.
    both: { browser: { x: 100, y: 450, w: 800, h: 440 }, term: { x: 100, y: 910, w: 800, h: 338 } },
    scale: 1.15,
    termFont: 25,
    // Cards sit in the full-width band above the button rail.
    card: { top: 288, right: 192, bottom: VERTICAL_H - RAIL_Y, left: 120 },
    cardScale: 0.66,
  },
};

// isFormat tells whether name is one of the formats.
export const isFormat = (name) => Object.hasOwn(FORMATS, name);

// assertFormats throws unless every name in list is a known format. where
// says what the list came from, for the message.
export function assertFormats(list, where = '') {
  for (const f of list) {
    if (!isFormat(f)) throw new Error(`unknown format ${f}${where}; want one of ${Object.keys(FORMATS).join(', ')}`);
  }
}

// stageConfig builds the config passed to stage.init for one format.
// A scene with two terminal panes (term2) and no browser splits the
// terminal's rectangle in two: side by side when it's clearly wider than
// tall, stacked otherwise.
/**
 * @param {string} fmtName
 * @param {import('./types.js').Scene} scene
 * @param {{ browser?: boolean, term?: boolean, term2?: boolean }} panels
 * @param {{ guides?: boolean }} [options]
 * @returns {import('./types.js').StageConfig}
 */
export function stageConfig(fmtName, scene, panels, { guides = false } = {}) {
  assertFormats([fmtName]);
  const f = FORMATS[fmtName];
  if (panels.term2 && panels.browser) throw new Error('a scene with a second terminal (pane: 2) can\'t also have a browser panel');
  const both = panels.browser && panels.term;
  const focus = both && f.focus && scene.layout !== 'both' ? f.focus : null;
  const single = scene.layout === 'max' ? (f.max ?? f.single) : f.single;
  const rect = (name) => (focus ?? (both ? f.both[name] : single));
  const scale = pick(scene.browser?.scale, fmtName) ?? f.scale;
  let termPadRight = 0;
  if (f.safe?.rail && panels.term) {
    // Keep terminal text clear of the right-hand button rail.
    const t = rect('term');
    termPadRight = Math.max(0, t.x + t.w - (f.w - f.safe.rail.w));
  }
  let term = panels.term ? rect('term') : null;
  let term2 = null;
  if (panels.term2) {
    const r = rect('term');
    const gap = 30;
    if (r.w >= r.h * 1.2) {
      const w = Math.floor((r.w - gap) / 2);
      term = { ...r, w };
      term2 = { ...r, x: r.x + w + gap, w };
    } else {
      const h = Math.floor((r.h - gap) / 2);
      term = { ...r, h };
      term2 = { ...r, y: r.y + h + gap, h };
    }
  }
  // view: browser / term / both steps (16x9 and the other side-by-side
  // layouts): one panel takes the rectangle a one-panel scene would get
  // ("single", or "max" with layout: max), so it looks exactly like a
  // browser-only or terminal-only scene, and the other fades out. views
  // holds each panel's rectangle in each view.
  let views = null;
  if (both && !focus && !panels.term2) {
    views = {
      both: { browser: rect('browser'), term: rect('term') },
      browser: { browser: single },
      term: { term: single },
    };
  }
  return {
    w: f.w,
    h: f.h,
    bar: TITLE_BAR,
    caption: { left: 40, right: 40, ...f.caption },
    theme: scene.theme,
    termFont: pick(scene.terminal?.fontSize, fmtName) ?? f.termFont,
    termTitle: scene.terminal?.title ?? '~ — bash',
    termPadRight,
    term2Title: scene.terminal2?.title ?? '~ — bash',
    browser: panels.browser ? { ...rect('browser'), scale } : null,
    term,
    term2,
    focus: Boolean(focus),
    views,
    safe: f.safe ?? null,
    card: f.card ?? null,
    cardScale: f.cardScale ?? 1,
    guides,
  };
}

// pick lets a scene setting be either one value or a per-format map,
// e.g. scale: 1.1 or scale: { 16x9: 1.2, 1x1: 0.9 }.
function pick(v, fmtName) {
  if (v && typeof v === 'object') return v[fmtName];
  return v;
}
