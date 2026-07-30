# disertasi-web

Static web output **and** a repo/file monitor for the doctoral dissertation
**_Cryptocurrency Classification Under Islamic Law — Jurisprudential Analysis,
Methodological Divergence, and a Proposed Framework_**.

Two deliverables live here:

1. **Web page** — a clean static site that renders the dissertation (title page,
   table of contents, browsable chapters + appendices rendered from Markdown, and
   PDF/DOCX download links). Deploys to Vercel.
2. **Project monitor** — a reproducible manifest (`manifest.json` + `MANIFEST.md`)
   indexing every repo and file in the dissertation project, with size,
   last-updated date, and a link back to the source on GitHub.

The dissertation prose lives in the separate [`zudin2007/Disertasi`](https://github.com/zudin2007/Disertasi)
repo. This project never edits that content — it **mirrors** it (via `npm run sync`)
so the site stays a faithful, rebuildable rendering of the source.

---

## Live site

- **Public URL:** https://disertasi-web.vercel.app/
- The GitHub repo is connected to Vercel, so every push to `main` triggers a
  build (`vercel.json`: `node scripts/build-site.js` → `dist/`) and re-renders the
  Markdown from the committed `content/` snapshot — the pre-rendered multi-page
  site (branch-independent, PDF/DOCX bundled under `/downloads/`).

## Two build targets

- `dist/` — pre-rendered multi-page static site (`npm run build`). Best when the
  repo is connected to Vercel via Git: Vercel runs the build and re-renders the
  Markdown on every push. Config in `vercel.json`.
- `dist-spa/` — a single self-contained `index.html` (`npm run spa`) that renders
  the dissertation **live** from the public Disertasi repo (Markdown fetched from
  `raw.githubusercontent.com`, rendered client-side). Small enough to ship through
  the Vercel file-tree deploy API, and always reflects the latest pushed Markdown.
  This is what the live URL above serves.

## Quick start

```bash
npm install
npm run rebuild   # sync + manifest + build  → dist/
# open dist/index.html
```

## Scripts

| Command | What it does | Outputs |
| --- | --- | --- |
| `npm run sync` | Copy canonical Markdown + PDF/DOCX out of the Disertasi repo. Chapter order + metadata come from `Disertasi/build/manifest.json` (single source of truth). | `content/`, `public/downloads/` |
| `npm run manifest` | Walk every monitored repo and index every file (path, size, last-updated, GitHub link). | `manifest.json`, `MANIFEST.md` |
| `npm run build` | Render `content/*.md` → a static site (pure `markdown-it`, no headless browser). | `dist/` |
| `npm run rebuild` | `sync` → `manifest` → `build` in one step. | all of the above |

`sync` reads from `../Disertasi` by default; override with
`DISERTASI_DIR=/path/to/Disertasi npm run sync`.

`content/` and `public/downloads/` are **committed** (a snapshot of the source)
so the site builds standalone on Vercel or a fresh clone without the Disertasi
repo present. `dist/` and `node_modules/` are generated and git-ignored.

## Rebuild / redeploy the site

```bash
# 1. Pull the latest dissertation prose into this repo
DISERTASI_DIR=../Disertasi npm run sync
# 2. Regenerate the file/repo manifest
npm run manifest
# 3. Rebuild the static site
npm run build
# 4. Commit content/, manifest, and redeploy (git push triggers Vercel,
#    or use the Vercel CLI / dashboard "Redeploy").
```

Vercel build settings (also in `vercel.json`):

- **Install:** `npm install`
- **Build:** `node scripts/build-site.js`
- **Output directory:** `dist`
- **Framework preset:** Other / none

Because `content/` is committed, Vercel rebuilds the HTML from the Markdown on
every deploy — the live page re-renders from source and stays in sync.

## Regenerate the manifest

```bash
npm run manifest      # -> manifest.json (machine) + MANIFEST.md (human dashboard)
```

`manifest.json` is deterministic: files are sorted by path and dates come from
git commit timestamps (falling back to filesystem mtime), so the same tree
produces the same manifest. To add another repo to the monitor, edit the `REPOS`
array at the top of `scripts/generate-manifest.js`.

## Multilingual (i18n)

The English site renders from `content/site-manifest.json` into `dist/` (site
root). Each additional language is **pure data** — no code change needed:

- Drop that language's Markdown under **`content/<lang>/`** (e.g. `content/id/`).
- Add a **`content/<lang>/site-manifest.json`** listing its `sections`
  (`file`, `slug`, `title`, optional `sourceFile` for the "view source" link),
  `metadata`, and a `ui` object of localized labels.
- `npm run build` discovers every `content/<lang>/site-manifest.json` and renders
  it into **`dist/<lang>/`**, cross-linked with the English root via a language
  switcher in the sidebar.

**Bahasa Indonesia** lives at `content/id/` → served at `/id/`. Translator drops
new ID chapters into `content/id/` and adds a `sections` entry in
`content/id/site-manifest.json`; the source Markdown is mirrored from the
`Disertasi` repo's `id/` directory.

## Downloads / provenance

The site's **Download** buttons serve the committed, compact
`Disertasi_..._Complete.pdf` / `.docx` outputs (bundled under
`public/downloads/`), so downloads work on the live site independent of the
source repo's push state. The always-current full build
(`Dissertation_Full.pdf` / `.docx`, larger) is indexed with a GitHub link in
`MANIFEST.md`.

## Layout

```
disertasi-web/
├── scripts/
│   ├── sync-content.js       # mirror Markdown + deliverables from Disertasi
│   ├── generate-manifest.js  # build the repo/file manifest
│   └── build-site.js         # Markdown → static dist/
├── content/                  # synced Markdown snapshot (committed) + site-manifest.json
├── public/downloads/         # synced PDF/DOCX (committed)
├── dist/                     # generated static site (git-ignored)
├── manifest.json             # generated: machine-readable file index
├── MANIFEST.md               # generated: human dashboard
├── vercel.json               # Vercel build config
└── package.json
```
