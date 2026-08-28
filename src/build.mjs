#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   spaceailabs.ai — static site generator
   ═══════════════════════════════════════════════════════════════════

   WHY A HAND-ROLLED GENERATOR (and not Astro / Eleventy)

   The site is ~11 pages × 2 locales. Hand-written HTML at that size is
   a drift machine: 22 copies of <head>, 88 hreflang links to keep
   reciprocal by hand, and a nav change that means 22 edits with the
   23rd file silently forgotten. But a framework is the opposite
   overcorrection — Astro exists to ship component islands and bundle
   JS, and this site's JS budget is ~0 bytes.

   So: template literals and Node built-ins. No dependencies, no
   lockfile, no npm in CI.

   WHY THE OUTPUT IS COMMITTED

   This is already the house pattern in this founder's other repo —
   sty/infra/legal/gen.mjs carries the same reasoning, as do
   `make l10n-manifest-check` and the OpenAPI drift check. Committing
   the generated HTML buys four things a build-in-CI cannot:

     1. Nothing can take the site down. If npm, Node or Actions break,
        `main` still holds finished HTML and GitHub Pages serves it.
     2. The PR diff shows the exact bytes GitHub will serve.
     3. No deploy secrets and no deploy permissions — publishing is
        `git merge`.
     4. It matches Maliud/chartmind-website, which already publishes
        this way (legacy branch build from main at root).

   CI runs this file and `diff`s the result against the tree, so a
   stale artefact fails the build.

   ESCAPE HATCH: move to Eleventy if the page count passes ~30 or a
   blog/changelog is added — both mean collections, which is where
   ~350 lines of JS stops being the cheaper answer.

   INVARIANTS ENFORCED AT BUILD TIME (see check* functions)
     · every string has both `en` and `tr`      — no half-translated page
     · titles and descriptions unique + length  — the #1 small-site SEO defect
     · answer blocks ≤ 60 words, no pronoun start — LLM extractability
     · no fabricated metrics                     — the company's one rule
   ═══════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const site = json('site.json');
const LOCALES = ['en', 'tr'];
const DEFAULT_LOCALE = 'en';

/* Until the domain is cut over from Hostinger, the site is published to
   https://maliud.github.io/spaceailabs/ so it can be reviewed without
   touching DNS or company email. That preview lives under a sub-path;
   the real site will not.

     preview   BASE=/spaceailabs node src/build.mjs
     live      node src/build.mjs        (plus a CNAME file)

   BASE only affects *emitted* paths. `site` stays on the final domain
   throughout, because canonical, hreflang and the sitemap must always
   advertise where the site really lives — a preview build must never
   teach a crawler that the sub-path is home. */
const BASE = (process.env.BASE || '').replace(/\/$/, '');
const href = (path) => (BASE && path.startsWith('/') ? BASE + path : path);

/* ─── Helpers ─────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Pick a locale out of a {en, tr} pair, failing loudly on a gap.
 *  A missing translation must be a build error, not something noticed
 *  three months later by a Turkish visitor. */
function t(value, locale, where) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;      // locale-neutral literal
  const v = value[locale];
  if (v === undefined) throw new Error(`Missing "${locale}" translation at ${where}`);
  return v;
}

const abs = (path) => site.site.replace(/\/$/, '') + path;

/** Inline markup allowed inside prose: **bold**, [text](href), `mono`. */
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="data">$1</span>');
}

/* ─── Invariant checks ────────────────────────────────────────────── */

const seenTitles = new Set();
const seenDescriptions = new Set();

/** Marketing claims this company has decided it will not make.
 *  chartmind.space currently says "95%+ accuracy", which is invented;
 *  this guard exists so that class of copy can never reach the site. */
const BANNED = [
  { re: /\d+(\.\d+)?\s*%\s*(accuracy|accurate|doğruluk)/i, why: 'fabricated accuracy metric' },
  { re: /trusted by/i,                                     why: 'no customer logos exist' },
  { re: /\d+[KkMm]\+?\s*(users|downloads|kullanıcı|indirme)/i, why: 'inflated install count' },
  { re: /(revolutionary|seamless|cutting-edge|game-chang|unlock the power)/i, why: 'banned register' },
];

function checkCopy(text, where) {
  for (const { re, why } of BANNED) {
    if (re.test(text)) throw new Error(`Banned claim (${why}) at ${where}: "${text.slice(0, 80)}"`);
  }
}

/** Answer blocks are the unit an LLM lifts out of the page. They must
 *  stand alone: no pronoun opener, no "as mentioned above", ≤60 words. */
function checkAnswer(text, where) {
  const words = text.trim().split(/\s+/).length;
  if (words > 60) throw new Error(`Answer too long (${words} words, max 60) at ${where}`);
  if (/^(it|this|that|they|we|bu|o|onlar)\b/i.test(text.trim()))
    throw new Error(`Answer starts with a pronoun at ${where} — must name the entity`);
}

function checkMeta(title, description, where) {
  if (title.length > 60) throw new Error(`Title ${title.length} chars (max 60) at ${where}`);
  if (description.length < 110 || description.length > 158)
    throw new Error(`Description ${description.length} chars (want 110–158) at ${where}`);
  if (seenTitles.has(title)) throw new Error(`Duplicate title at ${where}: "${title}"`);
  if (seenDescriptions.has(description)) throw new Error(`Duplicate description at ${where}`);
  seenTitles.add(title);
  seenDescriptions.add(description);
}

/* ─── Block renderers ─────────────────────────────────────────────── */

const blocks = {
  /* Asymmetric hero: headline in cols 1–8, a mono spec table in 10–12.
     No image, no background treatment. The spec table publishes the
     company's real scale (TEAM 1) instead of hiding it — which is the
     whole positioning, compressed into six rows. */
  hero: (b, L, ctx) => `
  <section class="section-lg band">
    <div class="wrap grid">
      <div class="col-wide">
        ${b.kicker ? `<p class="mono">${esc(t(b.kicker, L, ctx))}</p>` : ''}
        <h1 class="display">${inline(t(b.h1, L, ctx))}</h1>
        <p class="lead">${inline(t(b.lead, L, ctx))}</p>
        ${(b.links || []).map((l) =>
          `<a class="cta" href="${esc(href(t(l.href, L, ctx)))}">${esc(t(l.label, L, ctx))}</a>`).join('\n        ')}
      </div>
      ${b.spec ? `<aside class="col-margin spec" aria-label="${esc(t(b.specLabel || 'Facts', L, ctx))}">
        <dl>${b.spec.map((r) =>
          `<div><dt class="mono">${esc(t(r.k, L, ctx))}</dt><dd class="data">${esc(t(r.v, L, ctx))}</dd></div>`
        ).join('')}</dl>
      </aside>` : ''}
    </div>
  </section>
  <hr class="split-rule">`,

  /* A question heading plus its self-contained answer. The pair is one
     block on purpose: it is the retrievable unit, and keeping them
     together makes it impossible to add a question without an answer. */
  qa: (b, L, ctx) => {
    const q = t(b.q, L, ctx);
    const a = t(b.a, L, ctx);
    checkAnswer(a, ctx); checkCopy(a, ctx); checkCopy(q, ctx);
    return `
  <section class="section band">
    <div class="wrap grid">
      <div class="col-main">
        <h2>${inline(q)}</h2>
        <p class="answer">${inline(a)}</p>
        ${(b.body || []).map((p) => {
          const s = t(p, L, ctx); checkCopy(s, ctx);
          return `<p>${inline(s)}</p>`;
        }).join('\n        ')}
      </div>
      ${b.note ? `<aside class="col-margin mono">${esc(t(b.note, L, ctx))}</aside>` : ''}
    </div>
  </section>`;
  },

  /* The look-us-up table: legal entity, registry numbers, Apple Team
     ID. No generated marketing page puts a company registry number near
     the top, because generated pages optimise for impressiveness and
     this optimises for falsifiability. */
  facts: (b, L, ctx) => `
  <section class="section band band-2">
    <div class="wrap">
      <h2>${inline(t(b.h2, L, ctx))}</h2>
      <p class="answer">${inline(t(b.a, L, ctx))}</p>
      <table class="facts">
        <tbody>${b.rows.map((r) => `
          <tr>
            <th class="mono" scope="row">${esc(t(r.k, L, ctx))}</th>
            <td class="data">${esc(t(r.v, L, ctx))}</td>
            <td class="verify">${r.verify ? esc(t(r.verify, L, ctx)) : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>`,

  /* Reverse-chronological ship log — the honest substitute for a
     testimonial carousel. Evidence of motion instead of evidence of
     scale; a changelog is earned, testimonials are borrowed. */
  log: (b, L, ctx) => `
  <section class="section band">
    <div class="wrap grid">
      <div class="col-wide">
        <h2>${inline(t(b.h2, L, ctx))}</h2>
        <ol class="log">${b.entries.map((e) => `
          <li><span class="mono">${esc(e.date)}</span><span>${inline(t(e.text, L, ctx))}</span></li>`).join('')}
        </ol>
      </div>
    </div>
  </section>`,

  /* Plain prose section. Used for "What we don't have", which converts
     every missing asset into a positioning statement. */
  prose: (b, L, ctx) => `
  <section class="section band ${b.tone === 'muted' ? 'band-2' : ''}">
    <div class="wrap grid">
      <div class="col-main">
        ${b.h2 ? `<h2>${inline(t(b.h2, L, ctx))}</h2>` : ''}
        ${b.paras.map((p) => {
          const s = t(p, L, ctx); checkCopy(s, ctx);
          return `<p>${inline(s)}</p>`;
        }).join('\n        ')}
      </div>
    </div>
  </section>`,
};

function renderBlocks(page, L) {
  return (page.blocks || []).map((b, i) => {
    const fn = blocks[b.type];
    if (!fn) throw new Error(`Unknown block type "${b.type}" in ${page.id}[${i}]`);
    return fn(b, L, `${page.id}#${b.type}[${i}]`);
  }).join('\n');
}

/* ─── Document shell ──────────────────────────────────────────────── */

function head(page, L) {
  const title = t(page.title, L, page.id);
  const description = t(page.description, L, page.id);
  checkMeta(title, description, `${page.id}/${L}`);

  const self = site.routes[page.id][L];
  // hreflang is generated from the route table and never hand-written,
  // so the cluster cannot drift out of reciprocity.
  const alts = LOCALES.map((l) =>
    `<link rel="alternate" hreflang="${l}" href="${abs(site.routes[page.id][l])}">`
  ).concat(
    `<link rel="alternate" hreflang="x-default" href="${abs(site.routes[page.id][DEFAULT_LOCALE])}">`
  ).join('\n  ');

  return `<!doctype html>
<html lang="${L}"${page.brand && page.brand !== 'parent' ? ` data-brand="${page.brand}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${abs(self)}">
  ${alts}

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SPACE AI LABS">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${abs(self)}">
  <meta property="og:locale" content="${L === 'tr' ? 'tr_TR' : 'en_US'}">
  <meta property="og:locale:alternate" content="${L === 'tr' ? 'en_US' : 'tr_TR'}">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="preload" href="${href('/assets/fonts/fraunces-var.woff2')}" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${href('/assets/fonts/instrument-var.woff2')}" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${href('/assets/css/site.css')}">
</head>`;
}

const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
      <path d="M0,0 L22,0 L32,10 L32,32 L0,32 Z"></path>
      <rect x="13" y="8" width="4" height="16" fill="var(--sal-paper)"></rect>
    </svg>`;

function nav(page, L) {
  const items = site.nav.map((id) => {
    const to = href(site.routes[id][L]);
    const label = esc(t(site.labels[id], L, `nav.${id}`));
    const current = id === page.id ? ' aria-current="page"' : '';
    return `<a href="${to}"${current}>${label}</a>`;
  }).join('\n        ');

  const other = L === 'en' ? 'tr' : 'en';
  const otherHref = href(site.routes[page.id][other]);

  return `
<body>
  <a class="skip" href="#main">${L === 'tr' ? 'İçeriğe geç' : 'Skip to content'}</a>
  <header class="nav">
    <div class="wrap nav-inner">
      <a class="brand" href="${href(site.routes.home[L])}">${MARK}SPACE AI LABS</a>
      <nav class="nav-links" aria-label="${L === 'tr' ? 'Ana menü' : 'Primary'}">
        ${items}
        <a class="lang" href="${otherHref}" hreflang="${other}" lang="${other}" rel="alternate">${other === 'tr' ? 'TÜRKÇE' : 'ENGLISH'}</a>
      </nav>
    </div>
  </header>
  <main id="main">`;
}

function footer(L) {
  const org = site.org;
  const col = (key, ids) => `
        <div>
          <h4>${esc(t(site.labels[key], L, `footer.${key}`))}</h4>
          <ul>${ids.map((id) =>
            `<li><a href="${href(site.routes[id][L])}">${esc(t(site.labels[id], L, id))}</a></li>`).join('')}</ul>
        </div>`;

  return `
  </main>
  <hr class="split-rule">
  <footer class="footer">
    <div class="wrap">
      <div class="footer-cols">
        ${col('products', ['chartmind', 'styvora'])}
        ${col('company', ['technology', 'careers', 'press'])}
      </div>
      <p class="footer-legal data">
        © ${site.year} ${esc(org.legalName)}<br>
        ${esc(org.address)}<br>
        MERSİS ${esc(org.mersis)} · VKN ${esc(org.vkn)} ·
        <a href="mailto:${esc(org.email)}">${esc(org.email)}</a>
      </p>
    </div>
  </footer>
</body>
</html>`;
}

/* ─── Emit ────────────────────────────────────────────────────────── */

function write(outPath, contents) {
  const full = join(ROOT, outPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return outPath;
}

function pageFile(routePath) {
  // "/" → index.html ; "/tr/urunler/" → tr/urunler/index.html
  const clean = routePath.replace(/^\/|\/$/g, '');
  return clean ? `${clean}/index.html` : 'index.html';
}

function buildCss() {
  const dir = join(HERE, 'styles');
  const css = readdirSync(dir).filter((f) => f.endsWith('.css')).sort()
    .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  // Comments are the documentation for the design decisions; they stay
  // in the source and are stripped only from the served file.
  const based = BASE ? css.replace(/url\("\/assets\//g, `url("${BASE}/assets/`) : css;
  const min = based
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return write('assets/css/site.css', min);
}

function buildSitemap(pages) {
  const urls = pages.map((p) => {
    const links = LOCALES.map((l) =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${abs(site.routes[p.id][l])}"/>`
    ).join('\n');
    return LOCALES.map((l) => `  <url>
    <loc>${abs(site.routes[p.id][l])}</loc>
${links}
  </url>`).join('\n');
  }).join('\n');

  return write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`);
}

function main() {
  const written = [];
  const pageDir = join(HERE, 'pages');
  const pages = readdirSync(pageDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(pageDir, f), 'utf8')));

  for (const page of pages) {
    if (!site.routes[page.id]) throw new Error(`No route for page "${page.id}"`);
    for (const L of LOCALES) {
      const html = head(page, L) + nav(page, L) + renderBlocks(page, L) + footer(L);
      written.push(write(pageFile(site.routes[page.id][L]), html));
    }
  }

  written.push(buildCss());
  written.push(buildSitemap(pages));
  written.push(write('.nojekyll', ''));

  console.log(`Built ${written.length} files:`);
  for (const w of written) console.log('  ' + w);
}

main();
