// Terminal sources as HTML: each terminal of a take as one self-contained
// page (<take>-terminal.html, -terminal2.html), text and CSS rather than
// pixels, so the window reflows to any width and its text can be copied.
// It plays in sync with the take and its -terminal.mp4 (0 is the take's
// first frame), and shows the final screen until played.
//
// Built from the kept replay log, like the video sources, but without
// Chrome: the stage's terminal calls (prompt, type, print, clear) are
// replayed here, including type's seeded rhythm (stage.html's rand), so
// each character lands when it does in the video.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { FORMATS } from './formats.js';

const PANES = [['term', 'terminal', 'termTitle'], ['term2', 'terminal2', 'term2Title']];

// The stage's typing rhythm: stage.html's rand (mulberry32, seed 1) and
// type's per-character sleep. One generator for the whole take, shared by
// both panes in the order the characters are typed. browser.type uses it
// too, with a scene's seed.
export function rhythm(seed = 1) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// terminalOps turns a log's events into each pane's operations, times in
// ms from the take's start (calls before it happen at 0):
//   { t, k: 'print', x, c }   append text x with class c
//   { t, k: 'type', x, d }    type x, character i at t + d[i]
//   { t, k: 'clear' }
export function terminalOps(log) {
  const rand = rhythm();
  // stage.init starts each terminal with a prompt (not a logged call).
  /** @type {Record<string, { t: number, k: string, x?: string, c?: string, t0?: number, d?: number[] }[]>} */
  const ops = { term: [{ t: 0, k: 'print', x: '$ ', c: 'prompt' }], term2: [{ t: 0, k: 'print', x: '$ ', c: 'prompt' }] };
  // Typing runs concurrently with later calls (and the other pane), and
  // every character draws from the one generator, so walk calls and
  // characters together in time order.
  const typing = [];
  const step = (until) => {
    for (;;) {
      let next = null;
      for (const ty of typing) if (ty.i < ty.chars.length && (!next || ty.at < next.at)) next = ty;
      if (!next || next.at > until) return;
      next.op.d.push(Math.round(next.at - next.op.t0));
      next.i++;
      // setTimeout drops the fraction of a millisecond (the replay's
      // virtual clock included), so the video's typing runs that much ahead.
      next.at += Math.trunc(1000 / next.cps * (0.6 + rand() * 0.8));
    }
  };
  for (const e of log.events) {
    step(e.t);
    const pane = e.args?.at(-1) === 'term2' ? 'term2' : 'term';
    const t = e.t;
    if (e.fn === 'prompt') ops[pane].push({ t, k: 'print', x: '$ ', c: 'prompt' });
    else if (e.fn === 'print') ops[pane].push({ t, k: 'print', x: e.args[0], c: e.args[1] || '' });
    else if (e.fn === 'clear') ops[pane].push({ t, k: 'clear' }, { t, k: 'print', x: '$ ', c: 'prompt' });
    else if (e.fn === 'type') {
      const op = { t, t0: t, k: 'type', x: e.args[0], d: [] };
      ops[pane].push(op);
      typing.push({ op, chars: [...e.args[0]], i: 0, at: t, cps: e.args[1] });
    }
  }
  step(Infinity);
  const t0 = log.t0;
  for (const p of Object.keys(ops)) {
    ops[p] = ops[p].map(({ t0: _, ...o }) => {
      const at = Math.max(0, o.t - t0);
      // A type that began before the take: shift its characters too.
      if (o.k === 'type') o.d = /** @type {number[]} */ (o.d).map((d) => Math.max(0, o.t + d - t0) - at);
      return { ...o, t: Math.round(at) };
    });
  }
  return ops;
}

// terminalHtmlJobs lists the HTML pages a kept log can write: { pane, html }.
export function terminalHtmlJobs(logDir, { force = false } = {}) {
  const meta = path.join(logDir, 'log.json');
  const cfg = JSON.parse(readFileSync(meta, 'utf8')).cfg;
  const base = logDir.replace(/\.log\/?$/, '');
  const logTime = statSync(meta).mtimeMs;
  return PANES.filter(([p]) => cfg[p])
    .map(([pane, name]) => ({ logDir, pane, html: `${base}-${name}.html` }))
    .filter((j) => force || !existsSync(j.html) || statSync(j.html).mtimeMs < logTime);
}

// writeTerminalHtml writes every terminal page of one kept log and returns
// the files written.
export function writeTerminalHtml(logDir, { force = false } = {}) {
  const jobs = terminalHtmlJobs(logDir, { force });
  if (!jobs.length) return [];
  const log = JSON.parse(readFileSync(path.join(logDir, 'log.json'), 'utf8'));
  const ops = terminalOps(log);
  for (const j of jobs) {
    const title = log.cfg[/** @type {string[]} */ (PANES.find(([p]) => p === j.pane))[2]] || 'bash';
    writeFileSync(j.html, page({
      title, scene: log.scene, ops: ops[j.pane], duration: Math.round(log.duration * 1000),
      font: log.cfg.termFont || 20, pane: log.cfg[j.pane].w,
      // As wide as the format's one-window terminal, even when the take
      // split the screen (07's two panes are half that).
      width: Math.max(log.cfg[j.pane].w, log.cfg.views?.term?.term?.w ?? FORMATS[log.format]?.single?.w ?? 0),
    }));
  }
  return jobs.map((j) => j.html);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page({ title, scene, ops, duration, font, pane, width }) {
  const data = JSON.stringify({ ops, duration }).replace(/</g, '\\u003c');
  // The window fills the page up to the format's one-window width. The
  // font is the take's down to the take's window width and shrinks below
  // it (to 11px): at the take's width it wraps like the video, wider the
  // lines get longer, narrower they reflow.
  const fluid = (font / pane * 100).toFixed(3);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(scene)} · ${esc(title)}</title>
<!-- No web fonts: opening this page contacts no one. It uses JetBrains Mono
     if installed, else the system monospace; to load it from Google Fonts,
     add its <link> here. -->
<style>
  /* democast terminal source: ${esc(scene)}. Restyle with these variables; the
     window (.dc-term) works on its own in another page with this CSS. */
  :root {
    --dc-bg: #0e1116; --dc-panel: #161b22; --dc-chrome: #21262d; --dc-line: #30363d;
    --dc-fg: #e6edf3; --dc-dim: #8b949e; --dc-prompt: #7ee787; --dc-out: #79c0ff;
    --dc-max-w: ${width}px;
    --dc-font: clamp(11px, ${fluid}cqi, ${font}px);
    --dc-height: min(75vh, 830px);
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--dc-bg); color: var(--dc-fg);
    font-family: Inter, system-ui, sans-serif; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 14px; padding: 24px 16px; }
  .dc-term { width: 100%; max-width: var(--dc-max-w); container-type: inline-size; background: var(--dc-panel);
    border: 1px solid var(--dc-line); border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
  .dc-bar { height: 46px; display: flex; align-items: center; gap: 9px; padding: 0 16px; background: var(--dc-chrome);
    border-bottom: 1px solid var(--dc-line); }
  .dc-dot { width: 13px; height: 13px; border-radius: 50%; flex: none; }
  .dc-title { margin-left: 14px; color: var(--dc-dim); font: 15px ui-monospace, monospace; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .dc-body { margin: 0; height: var(--dc-height); overflow: auto; padding: 20px 24px;
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: var(--dc-font); line-height: 1.5;
    white-space: pre-wrap; word-break: break-all; }
  .dc-body .prompt { color: var(--dc-prompt); } .dc-body .out { color: var(--dc-out); } .dc-body .err { color: var(--dc-dim); }
  .dc-caret { display: inline-block; width: .52em; height: 1.15em; background: var(--dc-fg); vertical-align: -.2em;
    animation: dc-blink 1s steps(1) infinite; }
  @keyframes dc-blink { 50% { opacity: 0; } }
  .dc-controls { width: 100%; max-width: var(--dc-max-w); display: flex; align-items: center; gap: 12px;
    color: var(--dc-dim); font: 14px ui-monospace, monospace; }
  .dc-controls button { background: var(--dc-chrome); color: var(--dc-fg); border: 1px solid var(--dc-line);
    border-radius: 8px; padding: 6px 12px; font: inherit; cursor: pointer; min-width: 44px; min-height: 36px; }
  .dc-controls input { flex: 1; min-width: 0; accent-color: var(--dc-prompt); }
  @media (prefers-reduced-motion: reduce) { .dc-caret { animation: none; } }
</style>
</head>
<body>
<div class="dc-term">
  <div class="dc-bar"><span class="dc-dot" style="background:#ff5f57"></span><span class="dc-dot" style="background:#febc2e"></span><span class="dc-dot" style="background:#28c840"></span><span class="dc-title">${esc(title)}</span></div>
  <pre class="dc-body" id="dc-body"></pre>
</div>
<div class="dc-controls">
  <button id="dc-play" aria-label="Play">▶</button>
  <input id="dc-seek" type="range" min="0" max="${duration}" step="1" value="${duration}" aria-label="Time">
  <span id="dc-time"></span>
  <button id="dc-speed" aria-label="Speed">1×</button>
</div>
<script type="application/json" id="dc-data">${data}</script>
<script>
// Plays the take's terminal: at time T (ms from the take's first frame,
// the same clock as the video), every operation up to T is on screen.
// Without playing, it shows the end. #t=12.5 opens at 12.5 s; ?autoplay plays.
(() => {
  const { ops, duration } = JSON.parse(document.getElementById('dc-data').textContent);
  const body = document.getElementById('dc-body'), seek = document.getElementById('dc-seek');
  const play = document.getElementById('dc-play'), time = document.getElementById('dc-time');
  const speedBtn = document.getElementById('dc-speed');
  const caret = Object.assign(document.createElement('span'), { className: 'dc-caret' });
  let next = 0, typing = [], T = -1, playing = false, speed = 1, last = 0;
  const reset = () => { body.textContent = ''; next = 0; typing = []; };
  // render brings the screen to time t; going back starts over.
  function render(t) {
    if (t < T) reset();
    T = t;
    while (next < ops.length && ops[next].t <= t) {
      const o = ops[next++];
      if (o.k === 'clear') { body.textContent = ''; typing = []; continue; }
      const s = document.createElement('span');
      if (o.c) s.className = o.c;
      body.append(s);
      if (o.k === 'print') s.textContent = o.x;
      else typing.push({ o, s, chars: [...o.x], n: 0 });
    }
    typing = typing.filter((ty) => {
      let n = ty.n;
      while (n < ty.chars.length && ty.o.t + ty.o.d[n] <= t) n++;
      if (n !== ty.n) { ty.s.textContent = ty.chars.slice(0, n).join(''); ty.n = n; }
      return n < ty.chars.length;
    });
    body.append(caret);
    if (playing) body.scrollTop = body.scrollHeight;
    seek.value = t;
    time.textContent = (t / 1000).toFixed(1) + ' / ' + (duration / 1000).toFixed(1) + ' s';
  }
  function tick(now) {
    if (!playing) return;
    const t = Math.min(duration, T + (now - last) * speed);
    last = now;
    render(t);
    if (t >= duration) setPlaying(false);
    else requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    playing = on;
    play.textContent = on ? '❚❚' : '▶';
    play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (on) { if (T >= duration) render(0); last = performance.now(); requestAnimationFrame(tick); }
  }
  play.onclick = () => setPlaying(!playing);
  seek.oninput = () => render(+seek.value);
  speedBtn.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; speedBtn.textContent = speed + '×'; };
  window.democastTerminal = { play: () => setPlaying(true), pause: () => setPlaying(false), seek: (s) => render(s * 1000), duration: duration / 1000 };
  const h = /#t=([\\d.]+)/.exec(location.hash);
  render(h ? Math.min(duration, +h[1] * 1000) : duration);
  body.scrollTop = body.scrollHeight;
  if (/[?&]autoplay/.test(location.search)) setPlaying(true);
})();
</script>
</body>
</html>
`;
}
