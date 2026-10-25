import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_EVENTS, SEED_VERSION } from "./lib/seed-json.mjs";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
} from "../site.config.mjs";
import {
  absolutePageUrl,
  categoryLabel,
  escapeHtml,
  escapeJson,
  familyLabel,
  formatFullDate,
  hostOf,
  isHttpUrl,
  localDate,
  pagePath,
  staticCitation,
  truncate,
} from "./lib/page-kit.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const PAGES_DIR = join(DIST, "e");
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STYLE = `
:root {
  --paper: #f6f2e9;
  --paper-deep: #efe9dc;
  --ink: #1c1a17;
  --ink-soft: #3f3a33;
  --muted: #6f675b;
  --rule: #d8cfbf;
  --rule-strong: #b9ae9b;
  --accent: #a6382b;
}
* { box-sizing: border-box; }
html { background: var(--paper); color-scheme: light; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: ui-serif, Georgia, "Songti SC", "Noto Serif SC", serif;
  line-height: 1.75;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration-color: var(--rule-strong); text-underline-offset: 3px; }
a:hover { color: var(--accent); text-decoration-color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.skip {
  position: absolute;
  left: -9999px;
  top: 0;
  background: var(--paper);
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--ink);
  z-index: 9;
}
.skip:focus { left: 1rem; top: 1rem; }
.masthead {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1.35rem 1.25rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem 1.5rem;
  border-bottom: 1px solid var(--ink);
}
.brand { font-size: 1.05rem; font-weight: 600; letter-spacing: 0.02em; text-decoration: none; }
.brand span {
  margin-left: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}
.back {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  text-decoration: none;
}
.sheet { max-width: 44rem; margin: 0 auto; padding: 2.1rem 1.25rem 4rem; }
.crumb {
  margin: 0 0 1.8rem;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}
.kicker {
  margin: 0 0 0.7rem;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.64rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 { margin: 0; font-size: clamp(1.75rem, 4.2vw, 2.6rem); line-height: 1.28; font-weight: 600; letter-spacing: -0.01em; }
.en { margin: 0.7rem 0 0; color: var(--muted); font-size: 1rem; line-height: 1.5; }
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  margin: 2rem 0 0;
  border-top: 1px solid var(--ink);
  border-bottom: 1px solid var(--rule);
}
.facts > div { padding: 0.8rem 0.9rem 0.8rem 0; border-right: 1px solid var(--rule); }
.facts > div:last-child { border-right: 0; }
.facts dt {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}
.facts dd { margin: 0.25rem 0 0; font-size: 0.92rem; line-height: 1.45; }
.summary { margin: 2rem 0 0; font-size: 1.06rem; line-height: 1.95; }
.note {
  margin: 1.1rem 0 0;
  padding-left: 0.8rem;
  border-left: 2px solid var(--rule-strong);
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.7;
}
.tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1.3rem 0 0; padding: 0; list-style: none; }
.tags li {
  padding: 0.18rem 0.45rem;
  border: 1px solid var(--rule);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  color: var(--ink-soft);
}
section { margin-top: 2.6rem; }
h2 {
  margin: 0 0 0.8rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--ink);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.64rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted);
}
.sources { margin: 0; padding: 0; list-style: none; counter-reset: src; }
.sources li {
  counter-increment: src;
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.6rem;
  padding: 0.9rem 0;
  border-bottom: 1px solid var(--rule);
}
.sources li::before {
  content: counter(src, decimal-leading-zero);
  padding-top: 0.2rem;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.62rem;
  color: var(--accent);
}
.source-name, .source-host {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  color: var(--muted);
}
.source-title { margin: 0.25rem 0 0; font-size: 0.92rem; line-height: 1.55; overflow-wrap: anywhere; }
.source-host { margin-top: 0.2rem; letter-spacing: 0.04em; }
.cite { padding: 1rem 1.1rem; border: 1px dashed var(--rule-strong); background: rgba(255, 255, 255, 0.35); }
.cite p {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.7rem;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.cite .hint { margin-top: 0.6rem; color: var(--muted); font-size: 0.62rem; }
.page-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem 1.2rem;
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--ink);
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", monospace;
  font-size: 0.6rem;
  line-height: 1.8;
  color: var(--muted);
}
@media (max-width: 600px) {
  .masthead { padding: 1rem; }
  .sheet { padding-top: 1.6rem; }
  .facts > div { border-right: 0; border-bottom: 1px solid var(--rule); padding: 0.6rem 0; }
  .facts > div:last-child { border-bottom: 0; }
}
@media print {
  body { background: #fff; }
  .masthead, .back, .skip { display: none; }
  .cite { background: none; }
}
`;

function validSources(seed) {
  return (seed.evidence || []).filter((source) => source && isHttpUrl(source.url));
}

function jsonLdFor(seed, pageUrl, sources, notes) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: seed.title,
    description: seed.summary,
    datePublished: seed.eventDate,
    inLanguage: "zh-CN",
    url: pageUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
    publisher: { "@type": "Organization", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
    articleSection: categoryLabel(seed.category),
    citation: sources.map((source) => source.url),
    about: (seed.tags || []).map((tag) => ({ "@type": "Thing", name: tag })),
    keywords: (seed.tags || []).join(", "),
  };
  if (seed.titleEn && seed.titleEn !== seed.title) {
    data.alternativeHeadline = seed.titleEn;
  }
  if (notes) data.disambiguatingDescription = notes;
  return data;
}

function renderPage(seed, sources, buildDate) {
  const pageUrl = absolutePageUrl(SITE_ORIGIN, seed.seedId);
  const dateText = formatFullDate(seed.eventDate, seed.datePrecision);
  const familyCount = new Set(sources.map((source) => source.family)).size;
  const description = truncate(seed.summary, 120);
  const citation = staticCitation({
    title: seed.title,
    eventDate: seed.eventDate,
    url: pageUrl,
    accessDate: buildDate,
  });
  const orgLine = seed.organization || seed.modelName || "—";
  const why =
    seed.meta && typeof seed.meta.why === "string" ? seed.meta.why.trim() : "";
  const note =
    seed.meta && typeof seed.meta.research_note === "string"
      ? seed.meta.research_note.trim()
      : "";
  const tags = (seed.tags || []).map(
    (tag) => `        <li>${escapeHtml(tag)}</li>`
  );
  const sourcesHtml = sources
    .map((source) => {
      const published = source.publishedAt
        ? `<span aria-hidden="true"> · </span>${escapeHtml(String(source.publishedAt).slice(0, 10))}`
        : "";
      return `        <li>
          <div>
            <p class="source-name">${escapeHtml(familyLabel(source.family))} · ${escapeHtml(source.name)}${published}</p>
            <p class="source-title"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a></p>
            <p class="source-host">${escapeHtml(hostOf(source.url))}</p>
          </div>
        </li>`;
    })
    .join("\n");
  const jsonLd = escapeJson(jsonLdFor(seed, pageUrl, sources, note));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(seed.title)} · ${escapeHtml(SITE_NAME)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="theme-color" content="#f6f2e9" />
  <meta name="color-scheme" content="light" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${escapeHtml(pageUrl)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  <meta property="og:title" content="${escapeHtml(seed.title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="article:published_time" content="${escapeHtml(seed.eventDate)}" />
  <meta name="twitter:card" content="summary" />
  <script type="application/ld+json" data-page-jsonld>${jsonLd}</script>
  <style>${STYLE}</style>
</head>
<body>
  <a class="skip" href="#main">跳到正文</a>
  <header class="masthead">
    <a class="brand" href="/">AI 纪年<span>AI Chronicle</span></a>
    <a class="back" href="/">完整时间轴 →</a>
  </header>
  <main id="main" class="sheet">
    <nav class="crumb" aria-label="位置"><a href="/">档案</a> / ${escapeHtml(String(seed.year))}</nav>
    <p class="kicker">${escapeHtml(categoryLabel(seed.category))} · 人工校订条目</p>
    <h1>${escapeHtml(seed.title)}</h1>
${seed.titleEn && seed.titleEn !== seed.title ? `    <p class="en">${escapeHtml(seed.titleEn)}</p>\n` : ""}    <dl class="facts">
      <div><dt>日期</dt><dd>${escapeHtml(dateText)}</dd></div>
      <div><dt>类别</dt><dd>${escapeHtml(categoryLabel(seed.category))}</dd></div>
      <div><dt>机构 / 模型</dt><dd>${escapeHtml(orgLine)}</dd></div>
      <div><dt>证据</dt><dd>${sources.length} 条 · ${familyCount} 类</dd></div>
    </dl>
    <p class="summary">${escapeHtml(seed.summary)}</p>
${note ? `    <p class="note">校订注记：${escapeHtml(note)}</p>\n` : ""}${why ? `    <section>\n      <h2>为什么重要</h2>\n      <p class="summary">${escapeHtml(why)}</p>\n    </section>\n` : ""}${tags.length ? `    <ul class="tags" aria-label="关键词">\n${tags.join("\n")}\n    </ul>\n` : ""}    <section>
      <h2>人工校订来源 · ${sources.length}</h2>
      <ol class="sources">
${sourcesHtml}
      </ol>
    </section>
    <section class="cite">
      <h2>引用本页</h2>
      <p>${escapeHtml(citation)}</p>
      <p class="hint">静态页随内容修订重新构建；实时合并证据与自动采集条目见时间轴。</p>
    </section>
    <footer class="page-foot">
      <span>静态引用页 · 档案版本 ${escapeHtml(SEED_VERSION)} · 构建于 ${escapeHtml(buildDate)}</span>
      <a href="/?e=${escapeHtml(seed.seedId)}">在时间轴中查看 →</a>
    </footer>
  </main>
</body>
</html>
`;
}

function renderSitemap(seeds, buildDate) {
  const urls = [
    `  <url>\n    <loc>${escapeHtml(`${SITE_ORIGIN}/`)}</loc>\n    <lastmod>${buildDate}</lastmod>\n  </url>`,
    ...seeds.map(
      (seed) =>
        `  <url>\n    <loc>${escapeHtml(
          absolutePageUrl(SITE_ORIGIN, seed.seedId)
        )}</loc>\n    <lastmod>${buildDate}</lastmod>\n  </url>`
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join(
    "\n"
  )}\n</urlset>\n`;
}

function renderRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

function homepageGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: SITE_NAME,
        alternateName: "AI Chronicle",
        url: `${SITE_ORIGIN}/`,
        inLanguage: "zh-CN",
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: SITE_NAME,
        url: `${SITE_ORIGIN}/`,
      },
    ],
  };
}

async function augmentHomepage() {
  const file = join(DIST, "index.html");
  let html = await readFile(file, "utf8");

  if (!/<script type="application\/ld\+json" data-site-jsonld>/.test(html)) {
    const block = `  <script type="application/ld+json" data-site-jsonld>${escapeJson(
      homepageGraph()
    )}</script>\n`;
    html = html.replace("</head>", `${block}</head>`);
  }

  if (!/<link rel="canonical"/.test(html)) {
    html = html.replace(
      "</head>",
      `  <link rel="canonical" href="${escapeHtml(`${SITE_ORIGIN}/`)}" />\n  <meta property="og:url" content="${escapeHtml(
        `${SITE_ORIGIN}/`
      )}" />\n  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />\n</head>`
    );
  }

  await writeFile(file, html, "utf8");
}

export async function buildPages() {
  if (SEED_EVENTS.length === 0) throw new Error("no seed events to publish");

  const seen = new Set();
  for (const seed of SEED_EVENTS) {
    const slug = seed.seedId;
    if (!SLUG_RE.test(slug)) throw new Error(`invalid seed slug: ${slug}`);
    if (seen.has(slug)) throw new Error(`duplicate seed slug: ${slug}`);
    seen.add(slug);
    if (!seed.title || !seed.summary) throw new Error(`incomplete seed: ${slug}`);
    if (validSources(seed).length === 0) {
      throw new Error(`seed without a valid source: ${slug}`);
    }
  }

  const homepage = join(DIST, "index.html");
  try {
    await readFile(homepage, "utf8");
  } catch {
    throw new Error("dist/index.html is missing; run the Vite build first");
  }

  const buildDate = localDate();
  await rm(PAGES_DIR, { recursive: true, force: true });
  await mkdir(PAGES_DIR, { recursive: true });

  let sourceCount = 0;
  for (const seed of SEED_EVENTS) {
    const sources = validSources(seed);
    sourceCount += sources.length;
    await writeFile(
      join(PAGES_DIR, `${seed.seedId}.html`),
      renderPage(seed, sources, buildDate),
      "utf8"
    );
  }

  const ordered = [...SEED_EVENTS].sort((a, b) =>
    a.sortDate === b.sortDate
      ? a.seedId.localeCompare(b.seedId)
      : a.sortDate.localeCompare(b.sortDate)
  );
  await writeFile(join(DIST, "sitemap.xml"), renderSitemap(ordered, buildDate), "utf8");
  await writeFile(join(DIST, "robots.txt"), renderRobots(), "utf8");
  await augmentHomepage();

  console.log(
    `pages        ${SEED_EVENTS.length} seed pages → dist${pagePath("<slug>")} (${sourceCount} sources)`
  );
  console.log(`sitemap      dist/sitemap.xml (${SEED_EVENTS.length + 1} urls)`);
  console.log("robots       dist/robots.txt");
  console.log("homepage     WebSite + Organization JSON-LD, canonical, og:url");
  console.log(`origin       ${SITE_ORIGIN}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPages();
}
