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
 *
 * i18n: the default (English) site is rendered from content/site-manifest.json
 * into dist/. Any additional language with a content/<lang>/site-manifest.json
 * is rendered into dist/<lang>/, cross-linked with a language switcher. Adding a
 * language is pure data — drop the Markdown + a site-manifest.json under
 * content/<lang>/; no code change needed. (DISAA-36: Bahasa Indonesia -> id.)
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

// English UI strings; per-language manifests override via their "ui" object.
const DEFAULT_UI = {
  eyebrow: 'Doctoral Dissertation',
  homeNav: 'Home & Downloads',
  tocHeading: 'Table of Contents',
  onThisPage: 'On this page',
  downloadHeading: 'Download',
  sourceLabel: 'View source',
  renderedFrom: 'Rendered from',
};

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

function sidebar(site, sections, activeSlug, opts) {
  const items = sections
    .map((s, i) => {
      const cls = s.slug === activeSlug ? ' class="active"' : '';
      const num = escapeHtml(s.navNumber || String(i + 1));
      return `<li${cls}><a href="${s.slug}.html"><span class="n">${num}</span>${escapeHtml(
        s.navLabel
      )}</a></li>`;
    })
    .join('\n');
  const langSwitch = opts.langSwitch
    ? `<div class="lang-switch"><a href="${escapeHtml(opts.langSwitch.href)}">${escapeHtml(
        opts.langSwitch.label
      )}</a></div>`
    : '';
  return `<nav class="sidebar" aria-label="Contents">
  <a class="brand" href="index.html">${escapeHtml(site.metadata.title)}</a>
  ${langSwitch}
  <ul>
    <li${activeSlug === 'index' ? ' class="active"' : ''}><a href="index.html"><span class="n">•</span>${escapeHtml(
    opts.ui.homeNav
  )}</a></li>
${items}
  </ul>
  <div class="repo"><a href="${escapeHtml(opts.repoUrl)}" rel="noopener">Source: ${escapeHtml(
    site.metadata.repository
  )}</a></div>
</nav>`;
}

function page(site, { title, sections, activeSlug, main, opts }) {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(opts.htmlLang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(site.metadata.title)}</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<button class="menu-toggle" onclick="document.body.classList.toggle('nav-open')" aria-label="Toggle contents">☰ Contents</button>
${sidebar(site, sections, activeSlug, opts)}
<main class="content">
${main}
</main>
</body>
</html>`;
}

/*
 * Render one language's site from a manifest into outDir.
 *   manifest  – parsed site-manifest.json
 *   contentDir – directory holding that language's Markdown
 *   outDir    – destination (dist/ for default, dist/<lang>/ for others)
 *   opts      – { htmlLang, langSwitch, ui, repoUrl, repoBranch }
 */
function renderSite(site, contentDir, outDir, opts) {
  // Derive friendly nav labels/numbers from filenames.
  const sections = site.sections.map((s) => {
    let navNumber = '';
    let navLabel = s.title;
    const cm = s.file.match(/^CHAPTER_(\d+)/i);
    const bm = s.file.match(/^BAB_(\d+)/i); // Indonesian chapters
    const am = s.file.match(/^APPENDIX_([A-Z0-9]+)/i);
    if (cm) navNumber = cm[1];
    else if (bm) navNumber = bm[1];
    else if (am) navNumber = 'App ' + am[1];
    else if (/^ABSTRA(CT|K)/i.test(s.file)) navNumber = '§';
    else if (/^EXECUTIVE/i.test(s.file)) navNumber = '§';
    else if (/^(CASE_STUDIES|GLOSSARY)/i.test(s.file)) navNumber = '§';
    return { ...s, navNumber, navLabel };
  });

  ensureDir(outDir);
  ensureDir(path.join(outDir, 'assets'));

  // Per-section pages.
  sections.forEach((s, i) => {
    const raw = fs.readFileSync(path.join(contentDir, s.file), 'utf8');
    const headings = [];
    const bodyHtml = newMd(headings).render(raw);
    const prev = i > 0 ? sections[i - 1] : null;
    const next = i < sections.length - 1 ? sections[i + 1] : null;
    const onThisPage =
      headings.length > 1
        ? `<aside class="on-this-page"><h2>${escapeHtml(opts.ui.onThisPage)}</h2><ul>${headings
            .map((h) => `<li><a href="#${h.slug}">${escapeHtml(h.title)}</a></li>`)
            .join('')}</ul></aside>`
        : '';
    const pager = `<nav class="pager">
      ${prev ? `<a class="prev" href="${prev.slug}.html">← ${escapeHtml(prev.navLabel)}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="${next.slug}.html">${escapeHtml(next.navLabel)} →</a>` : '<span></span>'}
    </nav>`;
    const sourceFile = s.sourceFile || s.file;
    const source = `<p class="source-link"><a href="${opts.repoUrl}/blob/${opts.repoBranch}/${sourceFile
      .split('/')
      .map(encodeURIComponent)
      .join('/')}" rel="noopener">${escapeHtml(opts.ui.sourceLabel)}: ${escapeHtml(
      sourceFile
    )}</a></p>`;
    const mainHtml = `<article class="doc">
${onThisPage}
${bodyHtml}
${source}
${pager}
</article>`;
    fs.writeFileSync(
      path.join(outDir, `${s.slug}.html`),
      page(site, { title: s.navLabel, sections, activeSlug: s.slug, main: mainHtml, opts })
    );
  });

  // Downloads block.
  const downloads = (site.downloads || [])
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
    <p class="eyebrow">${escapeHtml(opts.ui.eyebrow)}</p>
    <h1>${escapeHtml(site.metadata.title)}</h1>
    <p class="subtitle">${escapeHtml(site.metadata.subtitle || '')}</p>
    <p class="byline">${escapeHtml(site.metadata.author || '')} · ${escapeHtml(
    String(site.metadata.date || '')
  )}</p>
  </div>
  ${downloads ? `<section class="downloads"><h2>${escapeHtml(opts.ui.downloadHeading)}</h2><div class="dl-row">${downloads}</div></section>` : ''}
  <section class="toc">
    <h2>${escapeHtml(opts.ui.tocHeading)}</h2>
    <ol class="toc-list">
${toc}
    </ol>
  </section>
  <p class="source-link"><a href="${opts.repoUrl}" rel="noopener">${escapeHtml(
    opts.ui.renderedFrom
  )} ${escapeHtml(site.metadata.repository)}</a></p>
</article>`;
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    page(site, { title: opts.ui.homeNav, sections, activeSlug: 'index', main: home, opts })
  );

  fs.writeFileSync(path.join(outDir, 'assets', 'style.css'), CSS);

  // Copy deliverables into <outDir>/downloads.
  if (fs.existsSync(DOWNLOADS_SRC)) {
    const dst = path.join(outDir, 'downloads');
    ensureDir(dst);
    for (const f of fs.readdirSync(DOWNLOADS_SRC)) {
      fs.copyFileSync(path.join(DOWNLOADS_SRC, f), path.join(dst, f));
    }
  }

  console.log(
    `Built ${sections.length + 1} pages (${opts.htmlLang}) -> ${path.relative(PROJECT, outDir) || '.'}/`
  );
}

function loadManifest(dir) {
  const p = path.join(dir, 'site-manifest.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function optsFor(site, extra) {
  const repoUrl = 'https://' + String(site.metadata.repository || '').replace(/^https?:\/\//, '');
  return {
    ui: { ...DEFAULT_UI, ...(site.ui || {}) },
    repoUrl,
    repoBranch: site.metadata.repoBranch || 'main',
    ...extra,
  };
}

function main() {
  const en = loadManifest(CONTENT);
  if (!en) {
    throw new Error('content/site-manifest.json not found. Run `npm run sync` first.');
  }

  // Discover additional-language manifests: content/<lang>/site-manifest.json.
  const langs = fs
    .readdirSync(CONTENT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ lang: d.name, manifest: loadManifest(path.join(CONTENT, d.name)) }))
    .filter((l) => l.manifest);

  // Default (English) site at dist/. Switcher points to each extra language.
  const enSwitch =
    langs.length > 0
      ? { href: `${langs[0].lang}/index.html`, label: langLabel(langs[0].lang) }
      : null;
  renderSite(en, CONTENT, DIST, optsFor(en, { htmlLang: 'en', langSwitch: enSwitch }));

  // Each additional language at dist/<lang>/, switcher back to English root.
  for (const { lang, manifest } of langs) {
    renderSite(
      manifest,
      path.join(CONTENT, lang),
      path.join(DIST, lang),
      optsFor(manifest, { htmlLang: lang, langSwitch: { href: '../index.html', label: 'English' } })
    );
  }
}

function langLabel(code) {
  const names = { id: 'Bahasa Indonesia', en: 'English' };
  return names[code] || code.toUpperCase();
}

try {
  main();
} catch (err) {
  console.error('build-site failed:', err.message);
  process.exit(1);
}
