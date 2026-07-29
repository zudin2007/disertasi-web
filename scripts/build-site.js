#!/usr/bin/env node
/*
 * build-site.js — render the synced Markdown into a static, browsable site in
 * dist/. Pure JS (markdown-it), no headless browser, so it builds cleanly on
 * Vercel. Run `npm run sync` first to populate content/.
 *
 *   node scripts/build-site.js
 *
 * Output: dist/index.html (title page + TOC + downloads), dist/<slug>.html per
 * section, dist/assets/style.css, dist/downloads/* (copied deliverables).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const anchor = require('markdown-it-anchor');

const PROJECT = path.resolve(__dirname, '..');
const CONTENT = path.join(PROJECT, 'content');
const DOWNLOADS_SRC = path.join(PROJECT, 'public', 'downloads');
const DIST = path.join(PROJECT, 'dist');
const CSS = fs.readFileSync(path.join(PROJECT, 'templates', 'style.css'), 'utf8');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

// Deterministic, unique heading slugs (mirrors the PDF build's slugger).
function makeSlugger() {
  const seen = new Map();
  return (title) => {
    let base = String(title)
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\w\- ]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!base) base = 'section';
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

function newMd(headings) {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  md.use(anchor, {
    slugify: makeSlugger(),
    callback: (token, info) => {
      const level = Number(token.tag.slice(1));
      if (level === 2) headings.push({ title: info.title, slug: info.slug });
    },
  });
  return md;
}

function sidebar(sections, activeSlug) {
  const items = sections
    .map((s, i) => {
      const cls = s.slug === activeSlug ? ' class="active"' : '';
      const num = escapeHtml(s.navNumber || String(i + 1));
      return `<li${cls}><a href="${s.slug}.html"><span class="n">${num}</span>${escapeHtml(
        s.navLabel
      )}</a></li>`;
    })
    .join('\n');
  return `<nav class="sidebar" aria-label="Contents">
  <a class="brand" href="index.html">${escapeHtml(SITE.metadata.title)}</a>
  <ul>
    <li${activeSlug === 'index' ? ' class="active"' : ''}><a href="index.html"><span class="n">•</span>Home &amp; Downloads</a></li>
${items}
  </ul>
  <div class="repo"><a href="${escapeHtml(REPO_URL)}" rel="noopener">Source: ${escapeHtml(
    SITE.metadata.repository
  )}</a></div>
</nav>`;
}

function page({ title, sections, activeSlug, main }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(SITE.metadata.title)}</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<button class="menu-toggle" onclick="document.body.classList.toggle('nav-open')" aria-label="Toggle contents">☰ Contents</button>
${sidebar(sections, activeSlug)}
<main class="content">
${main}
</main>
</body>
</html>`;
}

let SITE;
let REPO_URL;
let REPO_BRANCH;

function main() {
  const manifestPath = path.join(CONTENT, 'site-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('content/site-manifest.json not found. Run `npm run sync` first.');
  }
  SITE = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  REPO_URL = 'https://' + String(SITE.metadata.repository || '').replace(/^https?:\/\//, '');
  REPO_BRANCH = SITE.metadata.repoBranch || 'main';

  // Derive friendly nav labels/numbers from filenames.
  const sections = SITE.sections.map((s) => {
    let navNumber = '';
    let navLabel = s.title;
    const cm = s.file.match(/^CHAPTER_(\d+)/i);
    const am = s.file.match(/^APPENDIX_([A-Z0-9]+)/i);
    if (cm) navNumber = cm[1];
    else if (am) navNumber = 'App ' + am[1];
    else if (/^ABSTRACT/i.test(s.file)) navNumber = '§';
    else if (/^EXECUTIVE/i.test(s.file)) navNumber = '§';
    else if (/^CASE_STUDIES/i.test(s.file)) navNumber = '§';
    return { ...s, navNumber, navLabel };
  });

  ensureDir(DIST);
  ensureDir(path.join(DIST, 'assets'));

  // Per-section pages.
  sections.forEach((s, i) => {
    const raw = fs.readFileSync(path.join(CONTENT, s.file), 'utf8');
    const headings = [];
    const bodyHtml = newMd(headings).render(raw);
    const prev = i > 0 ? sections[i - 1] : null;
    const next = i < sections.length - 1 ? sections[i + 1] : null;
    const onThisPage =
      headings.length > 1
        ? `<aside class="on-this-page"><h2>On this page</h2><ul>${headings
            .map((h) => `<li><a href="#${h.slug}">${escapeHtml(h.title)}</a></li>`)
            .join('')}</ul></aside>`
        : '';
    const pager = `<nav class="pager">
      ${prev ? `<a class="prev" href="${prev.slug}.html">← ${escapeHtml(prev.navLabel)}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="${next.slug}.html">${escapeHtml(next.navLabel)} →</a>` : '<span></span>'}
    </nav>`;
    const source = `<p class="source-link"><a href="${REPO_URL}/blob/${REPO_BRANCH}/${encodeURIComponent(
      s.file
    )}" rel="noopener">View source: ${escapeHtml(s.file)}</a></p>`;
    const mainHtml = `<article class="doc">
${onThisPage}
${bodyHtml}
${source}
${pager}
</article>`;
    fs.writeFileSync(
      path.join(DIST, `${s.slug}.html`),
      page({ title: s.navLabel, sections, activeSlug: s.slug, main: mainHtml })
    );
  });

  // Downloads block.
  const downloads = (SITE.downloads || [])
    .map(
      (d) =>
        `<a class="dl" href="${escapeHtml(d.file)}" download><span class="dl-label">${escapeHtml(
          d.label
        )}</span><span class="dl-size">${fmtBytes(d.bytes)}</span></a>`
    )
    .join('\n');

  // TOC list for the home page.
  const toc = sections
    .map(
      (s) =>
        `<li><a href="${s.slug}.html"><span class="n">${escapeHtml(
          s.navNumber || '§'
        )}</span>${escapeHtml(s.title)}</a></li>`
    )
    .join('\n');

  const home = `<article class="doc home">
  <div class="title-page">
    <p class="eyebrow">Doctoral Dissertation</p>
    <h1>${escapeHtml(SITE.metadata.title)}</h1>
    <p class="subtitle">${escapeHtml(SITE.metadata.subtitle || '')}</p>
    <p class="byline">${escapeHtml(SITE.metadata.author || '')} · ${escapeHtml(
    String(SITE.metadata.date || '')
  )}</p>
  </div>
  ${downloads ? `<section class="downloads"><h2>Download</h2><div class="dl-row">${downloads}</div></section>` : ''}
  <section class="toc">
    <h2>Table of Contents</h2>
    <ol class="toc-list">
${toc}
    </ol>
  </section>
  <p class="source-link"><a href="${REPO_URL}" rel="noopener">Rendered from ${escapeHtml(
    SITE.metadata.repository
  )}</a></p>
</article>`;
  fs.writeFileSync(
    path.join(DIST, 'index.html'),
    page({ title: 'Home', sections, activeSlug: 'index', main: home })
  );

  fs.writeFileSync(path.join(DIST, 'assets', 'style.css'), CSS);

  // Copy deliverables into dist/downloads.
  if (fs.existsSync(DOWNLOADS_SRC)) {
    const dst = path.join(DIST, 'downloads');
    ensureDir(dst);
    for (const f of fs.readdirSync(DOWNLOADS_SRC)) {
      fs.copyFileSync(path.join(DOWNLOADS_SRC, f), path.join(dst, f));
    }
  }

  console.log(`Built ${sections.length + 1} pages -> dist/`);
  console.log(`  index.html + ${sections.length} sections, ${(SITE.downloads || []).length} downloads`);
}

try {
  main();
} catch (err) {
  console.error('build-site failed:', err.message);
  process.exit(1);
}
