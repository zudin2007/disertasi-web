#!/usr/bin/env node
/*
 * generate-manifest.js — deliverable 2: a reproducible index/dashboard of every
 * repo and file in the dissertation project.
 *
 *   node scripts/generate-manifest.js
 *
 * Walks each tracked repo, records path / size / last-updated (git commit date,
 * falling back to filesystem mtime) / category, and links each file back to its
 * GitHub blob. Emits:
 *   manifest.json  — machine-readable (path, bytes, updated, category, url)
 *   MANIFEST.md    — human dashboard grouped by repo + category
 *
 * Determinism: files are sorted by path; sizes and git dates are stable inputs,
 * so the same tree yields the same manifest.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT = path.resolve(__dirname, '..');

// Repos to monitor. `dir` is relative to this project; `github` is the base
// blob URL (null => local-only, not yet pushed).
const REPOS = [
  {
    name: 'Disertasi',
    dir: process.env.DISERTASI_DIR || '../Disertasi',
    github: 'https://github.com/zudin2007/Disertasi',
    branch: null, // detected from git below; falls back to 'main'
    note: 'Dissertation manuscript, appendices, build pipeline, research scripts.',
  },
  {
    name: 'disertasi-web',
    dir: '.',
    github: 'https://github.com/zudin2007/disertasi-web',
    branch: null, // detected from git below; falls back to 'main'
    note: 'This project: static web output + this monitoring manifest.',
  },
];

function detectBranch(repoDir, fallback) {
  try {
    return (
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || fallback
    );
  } catch {
    return fallback;
  }
}

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', '.vercel', '.next']);
const IGNORE_FILES = new Set(['.DS_Store']);

function categorize(rel) {
  const b = path.basename(rel).toLowerCase();
  const ext = path.extname(b);
  if (/^chapter_/i.test(b)) return 'Chapter';
  if (/^appendix_/i.test(b)) return 'Appendix';
  if (b === 'abstract.md' || b === 'executive_summary.md' || b === 'table_of_contents.md')
    return 'Front matter';
  if (ext === '.pdf' || ext === '.docx') return 'Built output';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'Script';
  if (ext === '.json') return 'Data/config';
  if (ext === '.css' || ext === '.html') return 'Web asset';
  if (ext === '.md') return 'Doc';
  return 'Other';
}

function walk(root) {
  const out = [];
  (function rec(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        rec(path.join(dir, e.name));
      } else if (e.isFile()) {
        if (IGNORE_FILES.has(e.name)) continue;
        out.push(path.join(dir, e.name));
      }
    }
  })(root);
  return out;
}

function gitDate(repoDir, relPath) {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return iso || null;
  } catch {
    return null;
  }
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function main() {
  const repos = [];
  for (const repo of REPOS) {
    const abs = path.resolve(PROJECT, repo.dir);
    if (!fs.existsSync(abs)) {
      console.warn(`  ! repo dir missing, skipped: ${repo.name} (${abs})`);
      continue;
    }
    const branch = repo.branch || detectBranch(abs, 'main');
    const files = walk(abs)
      .map((f) => path.relative(abs, f).split(path.sep).join('/'))
      .filter((rel) => {
        // For the current project, don't index generated dist output or the
        // manifest we are about to write (keeps the manifest self-consistent).
        if (repo.dir === '.' && (rel.startsWith('dist/') || rel === 'manifest.json')) return false;
        return true;
      })
      .sort();

    const entries = files.map((rel) => {
      const stat = fs.statSync(path.join(abs, rel));
      const updated = gitDate(abs, rel) || stat.mtime.toISOString();
      return {
        path: rel,
        bytes: stat.size,
        updated,
        category: categorize(rel),
        url: repo.github ? `${repo.github}/blob/${branch}/${encodeURI(rel)}` : null,
      };
    });

    repos.push({
      name: repo.name,
      github: repo.github,
      branch,
      note: repo.note,
      fileCount: entries.length,
      totalBytes: entries.reduce((a, e) => a + e.bytes, 0),
      files: entries,
    });
  }

  const manifest = {
    project: 'Cryptocurrency Classification Under Islamic Law — dissertation',
    // NOTE: generated timestamp intentionally omitted to keep output deterministic;
    // per-file `updated` (git commit date) carries provenance instead.
    repoCount: repos.length,
    fileCount: repos.reduce((a, r) => a + r.fileCount, 0),
    totalBytes: repos.reduce((a, r) => a + r.totalBytes, 0),
    repos,
  };
  fs.writeFileSync(path.join(PROJECT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // Human dashboard.
  const lines = [];
  lines.push(`# Dissertation Project — File & Repo Manifest`);
  lines.push('');
  lines.push(
    `> Generated by \`npm run manifest\` (\`scripts/generate-manifest.js\`). Do not hand-edit — regenerate.`
  );
  lines.push('');
  lines.push(
    `**${manifest.repoCount} repos · ${manifest.fileCount} files · ${fmtBytes(
      manifest.totalBytes
    )} total**`
  );
  lines.push('');
  for (const r of repos) {
    lines.push(`## ${r.name}`);
    lines.push('');
    lines.push(r.note);
    lines.push('');
    lines.push(
      `- Repo: ${r.github ? `[${r.github}](${r.github})` : '_local only — not yet pushed to GitHub_'}`
    );
    lines.push(`- Files: ${r.fileCount} · Size: ${fmtBytes(r.totalBytes)} · Branch: \`${r.branch}\``);
    lines.push('');
    const byCat = new Map();
    for (const f of r.files) {
      if (!byCat.has(f.category)) byCat.set(f.category, []);
      byCat.get(f.category).push(f);
    }
    for (const cat of [...byCat.keys()].sort()) {
      lines.push(`### ${cat}`);
      lines.push('');
      lines.push(`| File | Size | Last updated |`);
      lines.push(`| --- | ---: | --- |`);
      for (const f of byCat.get(cat)) {
        const name = f.url ? `[${f.path}](${f.url})` : `\`${f.path}\``;
        lines.push(`| ${name} | ${fmtBytes(f.bytes)} | ${f.updated.slice(0, 10)} |`);
      }
      lines.push('');
    }
  }
  fs.writeFileSync(path.join(PROJECT, 'MANIFEST.md'), lines.join('\n'));

  console.log(
    `Manifest: ${manifest.repoCount} repos, ${manifest.fileCount} files, ${fmtBytes(
      manifest.totalBytes
    )} -> manifest.json + MANIFEST.md`
  );
}

try {
  main();
} catch (err) {
  console.error('generate-manifest failed:', err.message);
  process.exit(1);
}
