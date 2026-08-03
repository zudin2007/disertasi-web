#!/usr/bin/env node
/*
 * sync-content.js — copy the canonical dissertation source out of the Disertasi
 * repo into this project so the web build is self-contained and reproducible on
 * Vercel (which only sees this project's files).
 *
 *   node scripts/sync-content.js
 *   DISERTASI_DIR=../Disertasi node scripts/sync-content.js
 *
 * Source of truth for chapter order + metadata is the Disertasi build manifest
 * (build/manifest.json). We do NOT re-decide the dissertation structure here;
 * we mirror it, then add a couple of clearly-front-matter extras for the web.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT = path.resolve(__dirname, '..');
const DISERTASI = path.resolve(PROJECT, process.env.DISERTASI_DIR || '../Disertasi');
const CONTENT = path.join(PROJECT, 'content');
const DOWNLOADS = path.join(PROJECT, 'public', 'downloads');

// Additional-language trees to mirror out of Disertasi. Each maps a source
// subdirectory in the Disertasi repo to a content/<lang>/ tree that build-site.js
// renders into dist/<lang>/. Chrome (ui strings, localized metadata) lives in the
// committed content/<lang>/site-manifest.json and is preserved across syncs — we
// only regenerate the ordered `sections` list from the translated Markdown.
const LOCALES = [{ lang: 'id', srcDir: 'id' }];

// Extra front/back matter to surface on the site beyond the compiled manifest.
// Inserted relative to the canonical section list; content decisions stay in the
// Disertasi repo — we only choose whether to LINK a file, not what it says.
const EXTRA_FRONT = [{ file: 'EXECUTIVE_SUMMARY.md', after: 'ABSTRACT.md' }];
const EXTRA_BACK = ['CASE_STUDIES.md'];

// Downloadable deliverables (repo path -> served filename).
// We bundle the committed, compact "_Complete" outputs so downloads work on the
// live site regardless of the repo's push state. The always-current full build
// (Dissertation_Full.pdf/.docx, larger) is indexed with a GitHub link in
// MANIFEST.md / manifest.json instead of being bundled.
const DELIVERABLES = [
  {
    src: 'Disertasi_Cryptocurrency_Classification_Islamic_Finance_Complete.pdf',
    out: 'Dissertation.pdf',
    label: 'Dissertation (PDF)',
  },
  {
    src: 'Disertasi_Cryptocurrency_Classification_Islamic_Finance_Complete.docx',
    out: 'Dissertation.docx',
    label: 'Dissertation (DOCX)',
  },
];

function git(repoDir, args) {
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// Prefer the repo's REMOTE DEFAULT branch: it is what GitHub serves (pushed) and
// what raw.githubusercontent.com resolves for the live SPA. The local checkout
// may sit on a transient feature branch that isn't pushed. Fall back to the
// local branch, then 'main'.
function publishBranch(repoDir) {
  try {
    const ref = git(repoDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (ref) return ref.replace(/^origin\//, '');
  } catch {}
  try {
    return git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  } catch {
    return 'main';
  }
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function firstH1(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : fallback;
}

function slugify(file) {
  return file.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Clean a heading for use as a nav/TOC title: drop a leading "FILE.md — " artifact
// some translated files carry, and collapse whitespace.
function cleanTitle(raw, file) {
  let t = firstH1(raw, file.replace(/\.md$/i, ''));
  t = t.replace(/^\S+\.md\s*[—–-]\s*/i, '').replace(/\s+/g, ' ').trim();
  return t;
}

// Deterministic front-to-back order: abstract, executive summary, numbered
// chapters (BAB_n / CHAPTER_n), glossary, then appendices (A8, B..G lexically).
function sectionOrder(file) {
  const f = file.toUpperCase();
  if (/^ABSTRA(K|CT)/.test(f)) return 0;
  if (/^EXECUTIVE/.test(f)) return 5;
  const n = f.match(/^(?:BAB|CHAPTER)_(\d+)/);
  if (n) return 100 + Number(n[1]);
  if (/^GLOSSARY/.test(f)) return 800;
  if (/^APPENDIX/.test(f)) return 900;
  return 500;
}

/*
 * Mirror one localized Markdown tree (Disertasi/<srcDir>/) into content/<lang>/
 * and regenerate its site-manifest.json `sections`. Files already committed under
 * content/<lang>/ but absent from the source (e.g. Bab 1, whose translation lives
 * on a different Disertasi branch) are preserved so the live site never regresses.
 * Localized chrome (metadata + ui) in the existing manifest is kept verbatim.
 */
function syncLocale({ lang, srcDir }) {
  const srcRoot = path.join(DISERTASI, srcDir);
  const outDir = path.join(CONTENT, lang);
  const manifestPath = path.join(outDir, 'site-manifest.json');
  const existing = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {};

  ensureDir(outDir);

  // Union of translated sources (copied fresh) and previously-committed .md files.
  const fromSource = fs.existsSync(srcRoot)
    ? fs.readdirSync(srcRoot).filter((f) => /\.md$/i.test(f))
    : [];
  for (const f of fromSource) {
    fs.copyFileSync(path.join(srcRoot, f), path.join(outDir, f));
  }
  const committed = fs.readdirSync(outDir).filter((f) => /\.md$/i.test(f));
  const files = Array.from(new Set([...fromSource, ...committed])).sort(
    (a, b) => sectionOrder(a) - sectionOrder(b) || a.localeCompare(b)
  );

  const sections = files.map((file) => {
    const raw = fs.readFileSync(path.join(outDir, file), 'utf8');
    return {
      file,
      sourceFile: `${srcDir}/${file}`,
      slug: slugify(file),
      title: cleanTitle(raw, file),
    };
  });

  const branch = publishBranch(DISERTASI);
  const manifest = {
    lang,
    metadata: {
      ...(existing.metadata || {}),
      repository: (existing.metadata && existing.metadata.repository) || 'github.com/zudin2007/Disertasi',
      repoBranch: branch,
    },
    ui: existing.ui || {},
    generatedFrom: `Disertasi/${srcDir}/ (branch ${branch}) — synced by scripts/sync-content.js`,
    sections,
    downloads: existing.downloads || [],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Synced ${sections.length} content files -> content/${lang}/ (${branch})`);
  return sections.length;
}

function main() {
  if (!fs.existsSync(DISERTASI)) {
    throw new Error(
      `Disertasi source repo not found at ${DISERTASI}. Set DISERTASI_DIR to its path.`
    );
  }
  const buildManifestPath = path.join(DISERTASI, 'build', 'manifest.json');
  if (!fs.existsSync(buildManifestPath)) {
    throw new Error(`Canonical build manifest missing: ${buildManifestPath}`);
  }
  const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));

  // Compose the ordered file list: manifest sections + front/back extras.
  const files = buildManifest.sections.map((s) => s.file);
  for (const extra of EXTRA_FRONT) {
    const idx = files.indexOf(extra.after);
    if (idx >= 0 && !files.includes(extra.file)) files.splice(idx + 1, 0, extra.file);
  }
  for (const f of EXTRA_BACK) if (!files.includes(f)) files.push(f);

  ensureDir(CONTENT);
  ensureDir(DOWNLOADS);

  const sections = [];
  const missing = [];
  for (const file of files) {
    const src = path.join(DISERTASI, file);
    if (!fs.existsSync(src)) {
      missing.push(file);
      continue;
    }
    const raw = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(path.join(CONTENT, file), raw);
    const slug = file.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    sections.push({ file, slug, title: firstH1(raw, file.replace(/\.md$/i, '')) });
  }
  if (!sections.length) throw new Error('No content files were synced — nothing to build.');

  // Copy the downloadable deliverables (skip any that are absent).
  const downloads = [];
  for (const d of DELIVERABLES) {
    const src = path.join(DISERTASI, d.src);
    if (!fs.existsSync(src)) {
      console.warn(`  ! deliverable missing, skipped: ${d.src}`);
      continue;
    }
    fs.copyFileSync(src, path.join(DOWNLOADS, d.out));
    const bytes = fs.statSync(src).size;
    downloads.push({ file: `downloads/${d.out}`, label: d.label, bytes });
  }

  const siteManifest = {
    metadata: { ...buildManifest.metadata, repoBranch: publishBranch(DISERTASI) },
    generatedFrom: 'Disertasi/build/manifest.json (+ web front/back matter)',
    sections,
    downloads,
  };
  fs.writeFileSync(
    path.join(CONTENT, 'site-manifest.json'),
    JSON.stringify(siteManifest, null, 2) + '\n'
  );

  console.log(`Synced ${sections.length} content files -> content/`);
  console.log(`Synced ${downloads.length} deliverables -> public/downloads/`);
  if (missing.length) console.warn(`Skipped ${missing.length} missing: ${missing.join(', ')}`);

  // Mirror additional-language trees (e.g. Bahasa Indonesia -> content/id/).
  for (const locale of LOCALES) syncLocale(locale);
}

try {
  main();
} catch (err) {
  console.error('sync-content failed:', err.message);
  process.exit(1);
}
