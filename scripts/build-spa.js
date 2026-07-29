#!/usr/bin/env node
/*
 * build-spa.js — emit a single-file, self-contained web app (dist-spa/index.html)
 * that renders the dissertation live from the public Disertasi repo (Markdown is
 * fetched from raw.githubusercontent.com and rendered client-side with marked).
 *
 *   node scripts/build-spa.js
 *
 * Why a second build target: `build-site.js` pre-renders a multi-page static site
 * (best for a Git-connected Vercel project). This single-file SPA is small enough
 * to ship through the file-tree Vercel deploy API and always reflects the latest
 * pushed Markdown — no rebuild needed to stay in sync. Same content list + CSS as
 * the static site, so the two stay visually consistent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const CONTENT = path.join(PROJECT, 'content');
const OUT_DIR = path.join(PROJECT, 'dist-spa');
const CSS = fs.readFileSync(path.join(PROJECT, 'templates', 'style.css'), 'utf8');

const MARKED_CDN = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js';

function navMeta(file, title) {
  const cm = file.match(/^CHAPTER_(\d+)/i);
  const am = file.match(/^APPENDIX_([A-Z0-9]+)/i);
  let navNumber = '§';
  if (cm) navNumber = cm[1];
  else if (am) navNumber = 'App ' + am[1];
  return { navNumber, navLabel: title };
}

function main() {
  const manifestPath = path.join(CONTENT, 'site-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('content/site-manifest.json not found. Run `npm run sync` first.');
  }
  const site = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const repo = String(site.metadata.repository || 'github.com/zudin2007/Disertasi').replace(
    /^https?:\/\//,
    ''
  );
  // repository is "github.com/<owner>/<name>" — drop the host, keep the last two.
  const parts = repo.split('/').filter(Boolean);
  if (parts[0] && parts[0].includes('.')) parts.shift();
  const owner = parts[0];
  const name = parts[1];
  const branch = site.metadata.repoBranch || 'main';
  const rawBase = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/`;

  // Keep the embedded data compact: store just slug/file/title/nav per section and
  // let the client derive raw + blob URLs from rawBase / repoUrl. Fewer repeated
  // long strings => smaller, more robust output.
  const sections = site.sections.map((s) => ({
    slug: s.slug,
    file: s.file,
    title: s.title,
    n: navMeta(s.file, s.title).navNumber,
  }));

  // Downloads point at the compact committed deliverables in the source repo.
  const downloads = [
    { label: 'Dissertation (PDF)', file: 'Disertasi_Cryptocurrency_Classification_Islamic_Finance_Complete.pdf' },
    { label: 'Dissertation (DOCX)', file: 'Disertasi_Cryptocurrency_Classification_Islamic_Finance_Complete.docx' },
  ];

  const data = {
    metadata: site.metadata,
    repoUrl: `https://github.com/${owner}/${name}`,
    rawBase,
    branch,
    sections,
    downloads,
  };
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.metadata.title)}</title>
<meta name="description" content="${esc(site.metadata.subtitle || site.metadata.title)}">
<style>${CSS}
.spa-status{color:var(--muted);font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:2rem 0}
.spa-error{color:#8a2b2b;background:#f8ecec;border:1px solid #e6c9c9;border-radius:8px;padding:1rem 1.2rem;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
</style>
</head>
<body>
<button class="menu-toggle" onclick="document.body.classList.toggle('nav-open')" aria-label="Toggle contents">&#9776; Contents</button>
<nav class="sidebar" id="sidebar" aria-label="Contents"></nav>
<main class="content"><div class="doc" id="doc"><p class="spa-status">Loading&hellip;</p></div></main>
<script id="site-data" type="application/json">${dataJson}</script>
<script src="${MARKED_CDN}" crossorigin="anonymous"></script>
<script>${CLIENT_JS}</script>
</body>
</html>`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  // SPA fallback so deep links (e.g. /#chapter-3) and unknown paths still load.
  fs.writeFileSync(
    path.join(OUT_DIR, 'vercel.json'),
    JSON.stringify(
      { rewrites: [{ source: '/(.*)', destination: '/index.html' }], cleanUrls: true },
      null,
      2
    ) + '\n'
  );

  const bytes = Buffer.byteLength(html);
  console.log(`Built SPA -> dist-spa/index.html (${(bytes / 1024).toFixed(1)} KB, ${sections.length} sections)`);
  console.log(`  Renders live from ${rawBase}`);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Client runtime (kept as a string; no build step). Renders home + sections from
// the embedded data, fetching Markdown on demand and caching it in-memory.
const CLIENT_JS = `
(function(){
  var DATA = JSON.parse(document.getElementById('site-data').textContent);
  var cache = {};
  var docEl = document.getElementById('doc');
  var sideEl = document.getElementById('sidebar');
  if (window.marked && marked.setOptions) marked.setOptions({ gfm: true, breaks: false });

  function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
  function bySlug(slug){for(var i=0;i<DATA.sections.length;i++){if(DATA.sections[i].slug===slug)return i;}return -1;}
  function rawUrl(file){return DATA.rawBase + encodeURIComponent(file);}
  function blobUrl(file){return DATA.repoUrl + '/blob/' + DATA.branch + '/' + encodeURIComponent(file);}

  function renderSidebar(activeSlug){
    var html = '<a class="brand" href="#">'+escAttr(DATA.metadata.title)+'</a><ul>';
    html += '<li'+(activeSlug?'':' class="active"')+'><a href="#"><span class="n">&bull;</span>Home &amp; Downloads</a></li>';
    DATA.sections.forEach(function(s){
      var cls = s.slug===activeSlug?' class="active"':'';
      html += '<li'+cls+'><a href="#'+s.slug+'"><span class="n">'+escAttr(s.n)+'</span>'+escAttr(s.title)+'</a></li>';
    });
    html += '</ul><div class="repo"><a href="'+escAttr(DATA.repoUrl)+'" rel="noopener">Source: '+escAttr(DATA.metadata.repository||'')+'</a></div>';
    sideEl.innerHTML = html;
  }

  function renderHome(){
    var m = DATA.metadata;
    var dls = DATA.downloads.map(function(d){
      return '<a class="dl" href="'+escAttr(rawUrl(d.file))+'" target="_blank" rel="noopener"><span class="dl-label">'+escAttr(d.label)+'</span><span class="dl-size">from source repo</span></a>';
    }).join('');
    var toc = DATA.sections.map(function(s){
      return '<li><a href="#'+s.slug+'"><span class="n">'+escAttr(s.n)+'</span>'+escAttr(s.title)+'</a></li>';
    }).join('');
    docEl.innerHTML =
      '<div class="title-page"><p class="eyebrow">Doctoral Dissertation</p><h1>'+escAttr(m.title)+'</h1>'+
      '<p class="subtitle">'+escAttr(m.subtitle||'')+'</p>'+
      '<p class="byline">'+escAttr(m.author||'')+' &middot; '+escAttr(String(m.date||''))+'</p></div>'+
      '<section class="downloads"><h2>Download</h2><div class="dl-row">'+dls+'</div></section>'+
      '<section class="toc"><h2>Table of Contents</h2><ol class="toc-list">'+toc+'</ol></section>'+
      '<p class="source-link"><a href="'+escAttr(DATA.repoUrl)+'" rel="noopener">Rendered live from '+escAttr(DATA.metadata.repository||'')+' ('+escAttr(DATA.branch)+')</a></p>';
    renderSidebar(null);
    document.title = m.title;
    window.scrollTo(0,0);
  }

  function renderSection(idx){
    var s = DATA.sections[idx];
    renderSidebar(s.slug);
    document.title = s.title + ' — ' + DATA.metadata.title;
    var prev = idx>0?DATA.sections[idx-1]:null, next = idx<DATA.sections.length-1?DATA.sections[idx+1]:null;
    function pager(){
      return '<nav class="pager">'+
        (prev?'<a class="prev" href="#'+prev.slug+'">&larr; '+escAttr(prev.title)+'</a>':'<span></span>')+
        (next?'<a class="next" href="#'+next.slug+'">'+escAttr(next.title)+' &rarr;</a>':'<span></span>')+'</nav>';
    }
    function show(bodyHtml){
      docEl.innerHTML = bodyHtml +
        '<p class="source-link"><a href="'+escAttr(blobUrl(s.file))+'" rel="noopener">View source: '+escAttr(s.file)+'</a></p>'+ pager();
      window.scrollTo(0,0);
    }
    if (cache[s.slug]){ show(cache[s.slug]); return; }
    docEl.innerHTML = '<p class="spa-status">Loading '+escAttr(s.title)+'&hellip;</p>';
    fetch(rawUrl(s.file)).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
      .then(function(md){
        var body = (window.marked ? (marked.parse?marked.parse(md):marked(md)) : ('<pre>'+escAttr(md)+'</pre>'));
        cache[s.slug] = body;
        show(body);
      })
      .catch(function(err){
        docEl.innerHTML = '<div class="spa-error"><strong>Could not load this section.</strong><br>'+
          escAttr(String(err && err.message || err))+'<br><br>Open it directly on '+
          '<a href="'+escAttr(blobUrl(s.file))+'" rel="noopener">GitHub</a>.</div>'+ pager();
      });
  }

  function route(){
    var slug = (location.hash||'').replace(/^#/,'');
    if(!slug){ renderHome(); return; }
    var idx = bySlug(slug);
    if(idx<0){ renderHome(); return; }
    document.body.classList.remove('nav-open');
    renderSection(idx);
  }
  window.addEventListener('hashchange', route);
  route();
})();
`;

try {
  main();
} catch (err) {
  console.error('build-spa failed:', err.message);
  process.exit(1);
}
