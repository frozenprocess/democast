// Builds the project's web page (GitHub Pages) into _site/:
//
//   node scripts/build-site.mjs [--out DIR] [--repo URL]     # make site
//
//   index.html      pages/index.html, with the demo video
//   examples.html   examples.md
//   reference.html  docs/reference.md
//   img/            docs/img/ (the examples' screenshots)
//   demo.mp4, poster.jpg   docs/demo/ (recorded by scripts/demo-video.mjs)
//
// Every link is relative, so the site works at any address (a project page
// is served from /<repo>/). Links in the Markdown to other pages are
// rewritten to the built pages; links to files in the repository go to the
// repository at --repo (or $REPO_URL), and without one are plain text. A
// link or image that points at nothing fails the build.

import { Marked } from 'marked';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// PAGES maps a Markdown file to its built page.
const PAGES = [
  { md: 'docs/reference.md', html: 'reference.html', nav: 'Reference' },
  { md: 'examples.md', html: 'examples.html', nav: 'Examples' },
];
const PAGE_OF = Object.fromEntries(PAGES.map((p) => [p.md, p.html]));
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// slugger makes heading ids the way GitHub does, so the anchors in the
// Markdown ("#1-the-basics") work: lower case, punctuation dropped, spaces
// to hyphens, a repeat gets -1, -2.
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text.replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

// render turns Markdown into HTML with ids on its headings, and returns it
// with the first heading's text.
export function render(markdown) {
  const slug = slugger();
  let title = '';
  const md = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = html.replace(/<[^>]*>/g, '');
        if (!title && depth === 1) title = text;
        return `<h${depth} id="${slug(html)}">${html}</h${depth}>\n`;
      },
    },
  });
  return { html: /** @type {string} */ (md.parse(markdown)), title };
}

// relink rewrites the links and images in html, which came from the file
// `from` (in the repository root), for the built site. problems collects
// the ones that point at nothing.
export function relink(html, { repo, problems, from }) {
  const fix = (url) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return { url };
    const [file, hash = ''] = url.split(/(?=#)/);
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(file)));
    if (!existsSync(path.join(ROOT, rel))) {
      problems.push(`${from}: ${url} points at nothing`);
      return { url };
    }
    if (rel === 'README.md') return { url: 'index.html' + hash };
    if (PAGE_OF[rel]) return { url: PAGE_OF[rel] + hash };
    if (rel.startsWith('docs/img/')) return { url: rel.replace(/^docs\//, '') + hash };
    // Anything else is a file in the repository.
    const kind = statSync(path.join(ROOT, rel)).isDirectory() ? 'tree' : 'blob';
    return { url: repo ? `${repo}/${kind}/HEAD/${rel.replace(/\/$/, '')}${hash}` : null };
  };
  return html
    .replace(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (all, url, rest, inner) => {
      const r = fix(url);
      return r.url ? `<a href="${r.url}"${rest}>${inner}</a>` : `<span class="path">${inner}</span>`;
    })
    .replace(/(<img\b[^>]*?\ssrc=")([^"]*)"/g, (all, pre, url) => `${pre}${fix(url).url ?? url}"`);
}

// layout wraps a page's content: the title, navigation and footer.
function layout({ title, description, content, current, repo, doc = true }) {
  const nav = [['Home', 'index.html'], ...PAGES.slice().reverse().map((p) => [p.nav, p.html])];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="site.css">
</head>
<body>
<header class="top"><nav>
  <a class="brand" href="index.html">democast</a>
  ${nav.map(([name, href]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${name}</a>`).join('\n  ')}
  ${repo ? `<a href="${repo}">GitHub</a>` : ''}
</nav></header>
<main${doc ? ' class="doc"' : ''}>
${content}
</main>
<footer>Built from the project's own README and examples${repo ? ` · <a href="${repo}">source</a>` : ''}.</footer>
</body>
</html>
`;
}

const DESCRIPTION = 'Record scripted demo videos of a live website and a real terminal, side by side.';

/**
 * @param {{ out?: string, repo?: string }} options
 * @returns {string[]} the problems found (the build wrote nothing if any)
 */
export function build({ out = path.join(ROOT, '_site'), repo = process.env.REPO_URL } = {}) {
  repo = repo?.replace(/\/+$/, '');
  /** @type {string[]} */
  const problems = [];
  const files = new Map();

  for (const p of PAGES) {
    const { html, title } = render(readFileSync(path.join(ROOT, p.md), 'utf8'));
    const content = relink(html, { repo, problems, from: p.md });
    files.set(p.html, layout({ title: `${title} · ${p.nav}`, description: DESCRIPTION, content, current: p.html, repo }));
  }

  const hasVideo = existsSync(path.join(ROOT, 'docs', 'demo', 'demo.mp4'));
  if (!hasVideo) problems.push('docs/demo/demo.mp4: missing (record it with: make demo-video)');
  const video = '<video controls preload="metadata" playsinline poster="poster.jpg" src="demo.mp4">' +
    'Your browser can\'t play this video: <a href="demo.mp4">download it</a>.</video>';
  const home = readFileSync(path.join(ROOT, 'pages', 'index.html'), 'utf8')
    .replace('<!--VIDEO-->', video)
    .replace('<!--REPO_BUTTON-->', repo ? ` <a class="btn alt" href="${repo}">GitHub</a>` : '');
  files.set('index.html', layout({ title: 'democast', description: DESCRIPTION, content: home, current: 'index.html', repo, doc: false }));

  if (problems.length) return problems;

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [name, text] of files) writeFileSync(path.join(out, name), text);
  cpSync(path.join(ROOT, 'pages', 'site.css'), path.join(out, 'site.css'));
  cpSync(path.join(ROOT, 'docs', 'img'), path.join(out, 'img'), { recursive: true });
  cpSync(path.join(ROOT, 'docs', 'demo', 'demo.mp4'), path.join(out, 'demo.mp4'));
  cpSync(path.join(ROOT, 'docs', 'demo', 'poster.jpg'), path.join(out, 'poster.jpg'));
  // Served as plain files: no Jekyll.
  writeFileSync(path.join(out, '.nojekyll'), '');
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = path.resolve(arg('--out') ?? path.join(ROOT, '_site'));
  const problems = build({ out, repo: arg('--repo') ?? process.env.REPO_URL });
  if (problems.length) {
    console.error(`build-site: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`built ${path.relative(process.cwd(), out) || '.'}/`);
}
