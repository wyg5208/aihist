import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_EVENTS } from "./lib/seed-json.mjs";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_TITLE,
} from "../site.config.mjs";
import {
  absolutePageUrl,
  categoryLabel,
  escapeHtml,
  isHttpUrl,
  localDate,
  pagePath,
  staticCitation,
  truncate,
} from "./lib/page-kit.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_PAGE_BYTES = 256 * 1024;
const MIN_PAGE_BYTES = 1024;

const ENTITY_RE = /&(?!(?:amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/;

function decodeEntities(value) {
  return String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => {
    if (name === "amp") return "&";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return '"';
    return "'";
  });
}

function countOccurrences(html, needle) {
  return html.split(needle).length - 1;
}

function datePattern(precision) {
  if (precision === "year") return /^\d{4}$/;
  if (precision === "month") return /^\d{4}-\d{2}$/;
  return /^\d{4}-\d{2}-\d{2}$/;
}

function orderedSeeds(seeds) {
  return [...seeds].sort((a, b) =>
    a.sortDate === b.sortDate
      ? a.seedId.localeCompare(b.seedId)
      : a.sortDate.localeCompare(b.sortDate)
  );
}

function allowedInternalHref(href, slug, slugs) {
  if (href === "/") return true;
  if (href === `/?e=${slug}`) return true;
  if (href === pagePath(slug)) return true;
  if (href.startsWith("/?e=")) return slugs.has(href.slice(4));
  if (href.startsWith("/e/") && href.endsWith(".html")) {
    return slugs.has(href.slice(3, -5));
  }
  return false;
}

/**
 * Full static-archive check. Returns a result object so the self-check can run
 * it against mutated copies without touching the real dist directory.
 */
export async function checkPages({ root = PROJECT_ROOT, quiet = false } = {}) {
  const projectRoot = resolve(root);
  const dist = join(projectRoot, "dist");
  const pagesDir = join(dist, "e");
  const errors = [];
  const fail = (message) => errors.push(message);

  const seedsBySlug = new Map(SEED_EVENTS.map((seed) => [seed.seedId, seed]));
  const expected = new Set(seedsBySlug.keys());
  const ordered = orderedSeeds(SEED_EVENTS);
  const stats = {
    origin: SITE_ORIGIN,
    buildDate: "",
    pages: 0,
    expectedPages: expected.size,
    canonical: 0,
    jsonLd: 0,
    evidenceLinks: 0,
    citations: 0,
    sourceCounts: 0,
    internalLinks: 0,
    sitemapUrls: 0,
    homepageAssets: 0,
  };

  let files = [];
  try {
    files = (await readdir(pagesDir)).filter((name) => name.endsWith(".html")).sort();
  } catch {
    fail("dist/e is missing; run npm run build first");
  }
  stats.pages = files.length;

  const actual = new Set(files.map((name) => name.replace(/\.html$/, "")));
  if (files.length !== expected.size) {
    fail(`page count: expected ${expected.size}, found ${files.length}`);
  }
  for (const slug of expected) {
    if (!actual.has(slug)) fail(`missing page: ${pagePath(slug)}`);
  }
  for (const slug of actual) {
    if (!expected.has(slug)) fail(`orphan page: ${pagePath(slug)}`);
  }

  const buildDates = new Set();
  const seenTitles = new Map();
  const seenSummaries = new Map();

  for (const slug of [...expected].sort()) {
    const seed = seedsBySlug.get(slug);
    const file = `e/${slug}.html`;
    let html = "";
    try {
      html = await readFile(join(pagesDir, `${slug}.html`), "utf8");
    } catch {
      continue;
    }

    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes < MIN_PAGE_BYTES) fail(`${file}: page is suspiciously small (${bytes}B)`);
    if (bytes > MAX_PAGE_BYTES) fail(`${file}: page is too large (${bytes}B)`);
    if (html.includes("\uFFFD")) fail(`${file}: contains a UTF-8 replacement character`);
    if (!html.startsWith("<!doctype html>")) fail(`${file}: missing doctype`);
    if (!html.includes('<html lang="zh-CN">')) fail(`${file}: missing lang="zh-CN"`);
    if (!html.trimEnd().endsWith("</html>")) fail(`${file}: missing closing html tag`);
    if (!html.includes('<meta charset="utf-8"')) fail(`${file}: missing charset`);
    if (!html.includes('name="viewport"')) fail(`${file}: missing viewport`);

    const pageUrl = absolutePageUrl(SITE_ORIGIN, slug);
    const title = escapeHtml(seed.title);
    const description = escapeHtml(truncate(seed.summary, 120));
    const sources = (seed.evidence || []).filter(
      (source) => source && isHttpUrl(source.url)
    );

    if (countOccurrences(html, "<h1>") !== 1) fail(`${file}: expected exactly one h1`);
    if (countOccurrences(html, "<h2>") < 2) fail(`${file}: expected at least two h2 sections`);
    if (!html.includes(`<title>${title} · ${escapeHtml(SITE_NAME)}</title>`)) {
      fail(`${file}: title is missing or not escaped`);
    }
    if (!html.includes(`<h1>${title}</h1>`)) {
      fail(`${file}: h1 is missing or not escaped`);
    }
    if (!html.includes(`<meta name="description" content="${description}"`)) {
      fail(`${file}: meta description is missing or differs from the curated summary`);
    }
    if (countOccurrences(html, 'rel="canonical"') !== 1) {
      fail(`${file}: expected exactly one canonical link`);
    }
    if (!html.includes(`<link rel="canonical" href="${escapeHtml(pageUrl)}"`)) {
      fail(`${file}: canonical is wrong`);
    } else {
      stats.canonical += 1;
    }
    if (!html.includes(`<meta property="og:url" content="${escapeHtml(pageUrl)}"`)) {
      fail(`${file}: og:url is wrong`);
    }
    if (!html.includes(`<meta property="og:title" content="${title}"`)) {
      fail(`${file}: og:title is wrong`);
    }
    if (!html.includes('<meta property="og:type" content="article"')) {
      fail(`${file}: og:type is not article`);
    }
    if (!html.includes(`<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}"`)) {
      fail(`${file}: og:site_name is wrong`);
    }
    if (!html.includes('<meta name="robots" content="index,follow"')) {
      fail(`${file}: page is not indexable`);
    }
    if (!html.includes(`<meta property="article:published_time" content="${escapeHtml(seed.eventDate)}"`)) {
      fail(`${file}: article:published_time is wrong`);
    }
    if (!datePattern(seed.datePrecision).test(seed.eventDate)) {
      fail(`${file}: eventDate does not match ${seed.datePrecision} precision`);
    }

    const sourcesMatch = html.match(/<ol class="sources">([\s\S]*?)<\/ol>/);
    const listedSources = sourcesMatch
      ? countOccurrences(sourcesMatch[1], "<li>")
      : 0;
    if (!sourcesMatch || listedSources !== sources.length) {
      fail(`${file}: source count ${listedSources} does not match ${sources.length}`);
    } else {
      stats.sourceCounts += 1;
    }
    if (sources.length === 0) fail(`${file}: no usable source`);
    if (
      !html.includes(
        `<h2>人工校订来源 · ${sources.length}</h2>`
      )
    ) {
      fail(`${file}: source heading does not match the source count`);
    }
    const families = new Set(sources.map((source) => source.family));
    if (
      !html.includes(
        `<div><dt>证据</dt><dd>${sources.length} 条 · ${families.size} 类</dd></div>`
      )
    ) {
      fail(`${file}: evidence fact is missing or wrong`);
    }

    const buildMatch = html.match(/构建于 (\d{4}-\d{2}-\d{2})/);
    const buildDate = buildMatch ? buildMatch[1] : "";
    if (!buildDate) {
      fail(`${file}: build date is missing`);
    } else {
      buildDates.add(buildDate);
    }
    if (!html.includes(`<a href="/?e=${escapeHtml(slug)}">在时间轴中查看 →</a>`)) {
      fail(`${file}: timeline back link is missing or wrong`);
    }

    const citeMatch = html.match(
      /<section class="cite">[\s\S]*?<h2>引用本页<\/h2>\s*<p>([\s\S]*?)<\/p>/
    );
    const actualCite = citeMatch ? citeMatch[1] : "";
    const expectedCite = staticCitation({
      title: seed.title,
      eventDate: seed.eventDate,
      url: pageUrl,
      accessDate: buildDate,
    });
    if (!actualCite || actualCite !== escapeHtml(expectedCite)) {
      fail(`${file}: citation text is missing or inconsistent with canonical/build date`);
    } else {
      stats.citations += 1;
    }
    if (
      slug === "turing-1950" &&
      !actualCite.includes(
        `[EB/OL]. AI 纪年, 1950-10. ${SITE_ORIGIN}/e/turing-1950.html（访问日期：${buildDate}）.`
      )
    ) {
      // Literal spot-check: a bug shared by build and check helpers cannot hide here.
      fail(`${file}: citation format deviates from the documented GB/T 7714-style sample`);
    }

    const anchorAttrs = [...html.matchAll(/<a\b([^>]*)>/g)].map((match) => match[1]);
    const external = new Set();
    for (const attrs of anchorAttrs) {
      const hrefMatch = attrs.match(/\bhref="([^"]*)"/);
      if (!hrefMatch) {
        fail(`${file}: anchor without href`);
        continue;
      }
      const href = decodeEntities(hrefMatch[1]);
      if (/^https?:/.test(href)) {
        external.add(href);
        if (!/rel="[^"]*noopener/.test(attrs)) {
          fail(`${file}: external link without rel=noopener — ${href}`);
        }
      } else if (href.startsWith("#")) {
        const id = href.slice(1);
        if (!html.includes(`id="${escapeHtml(id)}"`)) {
          fail(`${file}: fragment link has no matching id — ${href}`);
        }
      } else if (href.startsWith("/")) {
        if (!allowedInternalHref(href, slug, expected)) {
          fail(`${file}: internal link is not a known archive address — ${href}`);
        } else {
          stats.internalLinks += 1;
        }
      } else {
        fail(`${file}: invalid href — ${href}`);
      }
    }

    const expectedExternal = new Set(sources.map((source) => source.url));
    for (const url of expectedExternal) {
      if (!external.has(url)) fail(`${file}: evidence link missing for ${url}`);
      else stats.evidenceLinks += 1;
    }
    for (const url of external) {
      if (!expectedExternal.has(url)) {
        fail(`${file}: unexpected external link — ${url}`);
      }
    }

    const visible = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    if (ENTITY_RE.test(visible)) {
      fail(`${file}: unescaped ampersand in text or attributes`);
    }
    if (/>(?:undefined|null)<|content="(?:undefined|null)"|href="(?:undefined|null)"/.test(html)) {
      fail(`${file}: undefined/null leaked into the page`);
    }

    const scriptTags = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]);
    if (
      scriptTags.length !== 1 ||
      !/type="application\/ld\+json"/.test(scriptTags[0]) ||
      !/data-page-jsonld/.test(scriptTags[0])
    ) {
      fail(`${file}: expected exactly one JSON-LD script and no executable JavaScript`);
    }
    if (/<link[^>]+rel="(?:stylesheet|preload|preconnect|dns-prefetch)"/i.test(html)) {
      fail(`${file}: page loads an external subresource`);
    }
    if (/<script[^>]+src=/i.test(html)) fail(`${file}: page loads an external script`);
    if (/<img\b/i.test(html)) fail(`${file}: page contains an image request`);
    if (/(?:@import|url\(\s*['"]?https?:)/i.test(html)) {
      fail(`${file}: stylesheet imports a remote resource`);
    }

    const ldMatch = html.match(
      /<script type="application\/ld\+json" data-page-jsonld>([\s\S]*?)<\/script>/
    );
    const rawLd = ldMatch ? ldMatch[1] : "";
    if (!rawLd) {
      fail(`${file}: page JSON-LD is missing`);
    } else if (rawLd.includes("<") || rawLd.includes(">")) {
      fail(`${file}: page JSON-LD contains raw markup characters`);
    } else {
      let data = null;
      try {
        data = JSON.parse(rawLd);
      } catch {
        fail(`${file}: page JSON-LD is not valid JSON`);
      }
      if (data) {
        stats.jsonLd += 1;
        const check = (ok, message) => {
          if (!ok) fail(`${file}: ${message}`);
        };
        check(data["@context"] === "https://schema.org", "JSON-LD context");
        check(data["@type"] === "Article", "JSON-LD type");
        check(data.headline === seed.title, "JSON-LD headline");
        check(data.description === seed.summary, "JSON-LD description");
        check(data.datePublished === seed.eventDate, "JSON-LD datePublished");
        check(data.inLanguage === "zh-CN", "JSON-LD inLanguage");
        check(data.url === pageUrl, "JSON-LD url");
        check(data.mainEntityOfPage?.["@id"] === pageUrl, "JSON-LD mainEntityOfPage");
        check(
          data.isPartOf?.["@type"] === "WebSite" &&
            data.isPartOf?.url === `${SITE_ORIGIN}/`,
          "JSON-LD isPartOf"
        );
        check(
          data.publisher?.["@type"] === "Organization" &&
            data.publisher?.url === `${SITE_ORIGIN}/`,
          "JSON-LD publisher"
        );
        check(
          data.articleSection === categoryLabel(seed.category),
          "JSON-LD articleSection"
        );
        const citations = Array.isArray(data.citation) ? data.citation : [];
        check(
          citations.length === sources.length &&
            citations.join("\n") === sources.map((source) => source.url).join("\n"),
          "JSON-LD citation list"
        );
        check(new Set(citations).size === citations.length, "JSON-LD duplicate citation");
        check(
          (data.about || []).length === (seed.tags || []).length &&
            (data.about || []).every((item) => (seed.tags || []).includes(item.name)),
          "JSON-LD about list"
        );
        check(
          data.keywords === (seed.tags || []).join(", "),
          "JSON-LD keywords"
        );
        if (seed.titleEn && seed.titleEn !== seed.title) {
          check(
            data.alternativeHeadline === seed.titleEn,
            "JSON-LD alternativeHeadline"
          );
        } else {
          check(!data.alternativeHeadline, "JSON-LD unexpected alternativeHeadline");
        }
        const note =
          seed.meta && typeof seed.meta.research_note === "string"
            ? seed.meta.research_note.trim()
            : "";
        if (note) {
          check(
            data.disambiguatingDescription === note,
            "JSON-LD disambiguatingDescription"
          );
        } else {
          check(
            !data.disambiguatingDescription,
            "JSON-LD unexpected disambiguatingDescription"
          );
        }
      }
    }

    const titleKey = seed.title.trim();
    const summaryKey = seed.summary.trim();
    if (seenTitles.has(titleKey)) {
      fail(`${file}: duplicate title with ${seenTitles.get(titleKey)}`);
    } else {
      seenTitles.set(titleKey, file);
    }
    if (seenSummaries.has(summaryKey)) {
      fail(`${file}: duplicate summary with ${seenSummaries.get(summaryKey)}`);
    } else {
      seenSummaries.set(summaryKey, file);
    }
  }

  if (buildDates.size > 1) {
    fail(`build date differs across pages: ${[...buildDates].join(", ")}`);
  }
  const buildDate = [...buildDates][0] || "";
  stats.buildDate = buildDate;
  if (buildDate && buildDate !== localDate()) {
    // A stale build is allowed, but make it visible rather than silently passing.
    if (!quiet) {
      console.log(`note         built ${buildDate} (today ${localDate()})`);
    }
  }

  const sitemap = await readFile(join(dist, "sitemap.xml"), "utf8").catch(() => "");
  if (!sitemap) {
    fail("sitemap.xml is missing");
  } else {
    if (!sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
      fail("sitemap: missing XML declaration");
    }
    if (!sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) {
      fail("sitemap: missing urlset namespace");
    }
    if (!sitemap.trimEnd().endsWith("</urlset>")) {
      fail("sitemap: missing closing urlset");
    }
    if (ENTITY_RE.test(sitemap)) fail("sitemap: unescaped ampersand");
    for (const tag of ["url", "loc", "lastmod"]) {
      const open = countOccurrences(sitemap, `<${tag}>`);
      const close = countOccurrences(sitemap, `</${tag}>`);
      if (open !== close) fail(`sitemap: unbalanced <${tag}> tags (${open}/${close})`);
    }

    const blocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(
      (match) => match[1]
    );
    const locs = [];
    for (const block of blocks) {
      const locsInBlock = countOccurrences(block, "<loc>");
      const lastmodsInBlock = countOccurrences(block, "<lastmod>");
      const loc = block.match(/<loc>([^<]*)<\/loc>/)?.[1] || "";
      const lastmod = block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] || "";
      if (locsInBlock !== 1) fail("sitemap: url block must contain exactly one loc");
      if (lastmodsInBlock !== 1) fail("sitemap: url block must contain exactly one lastmod");
      if (!isHttpUrl(loc)) fail(`sitemap: loc is not absolute http(s) — ${loc}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
        fail(`sitemap: lastmod is not a date — ${lastmod}`);
      } else if (buildDate && lastmod !== buildDate) {
        fail(`sitemap: lastmod ${lastmod} differs from page build date ${buildDate}`);
      }
      locs.push(loc);
    }
    stats.sitemapUrls = locs.length;

    const expectedLocs = [
      `${SITE_ORIGIN}/`,
      ...ordered.map((seed) => absolutePageUrl(SITE_ORIGIN, seed.seedId)),
    ];
    if (locs.length !== expectedLocs.length) {
      fail(`sitemap: expected ${expectedLocs.length} urls, found ${locs.length}`);
    }
    for (let index = 0; index < Math.max(locs.length, expectedLocs.length); index += 1) {
      if (locs[index] !== expectedLocs[index]) {
        fail(
          `sitemap: url ${index + 1} is ${locs[index] || "missing"}, expected ${
            expectedLocs[index] || "none"
          }`
        );
      }
    }
    if (new Set(locs).size !== locs.length) fail("sitemap: duplicate urls");
    if (locs.some((loc) => /\/e\/[^/]+\/$/.test(loc))) {
      fail("sitemap: directory-style /e/<slug>/ loc is not served");
    }
  }

  const robots = await readFile(join(dist, "robots.txt"), "utf8").catch(() => "");
  if (!robots) {
    fail("robots.txt is missing");
  } else {
    const lines = robots.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.includes("User-agent: *")) fail("robots.txt: missing User-agent: *");
    if (!lines.includes("Allow: /")) fail("robots.txt: missing Allow: /");
    if (!lines.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)) {
      fail("robots.txt: sitemap is not declared");
    }
    if (lines.some((line) => line.startsWith("Disallow:"))) {
      fail("robots.txt: unexpected Disallow rule");
    }
  }

  const home = await readFile(join(dist, "index.html"), "utf8").catch(() => "");
  if (!home) {
    fail("index.html is missing");
  } else {
    if (!home.includes(`<title>${escapeHtml(SITE_TITLE)}</title>`)) {
      fail("homepage: title changed");
    }
    if (!home.includes('<html lang="zh-CN">')) fail("homepage: missing lang");
    if (countOccurrences(home, 'name="description"') !== 1) {
      fail("homepage: expected exactly one description meta");
    }
    const homeDescription = home.match(
      /<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/
    );
    if (!homeDescription || homeDescription[1] !== escapeHtml(SITE_DESCRIPTION)) {
      fail("homepage: description differs from site.config.mjs");
    }
    if (countOccurrences(home, 'rel="canonical"') !== 1) {
      fail("homepage: expected exactly one canonical link");
    }
    if (!home.includes(`<link rel="canonical" href="${escapeHtml(`${SITE_ORIGIN}/`)}"`)) {
      fail("homepage: canonical is missing or wrong");
    }
    if (!home.includes(`<meta property="og:url" content="${escapeHtml(`${SITE_ORIGIN}/`)}"`)) {
      fail("homepage: og:url is missing or wrong");
    }
    if (!home.includes('<meta property="og:type" content="website"')) {
      fail("homepage: og:type is not website");
    }
    if (countOccurrences(home, "data-site-jsonld") !== 1) {
      // one attribute on the script tag; more would mean a duplicated block
      fail("homepage: expected exactly one site JSON-LD block");
    }
    const siteMatch = home.match(
      /<script type="application\/ld\+json" data-site-jsonld>([\s\S]*?)<\/script>/
    );
    const rawSite = siteMatch ? siteMatch[1] : "";
    if (!rawSite) {
      fail("homepage: site JSON-LD is missing");
    } else if (rawSite.includes("<") || rawSite.includes(">")) {
      fail("homepage: site JSON-LD contains raw markup characters");
    } else {
      let data = null;
      try {
        data = JSON.parse(rawSite);
      } catch {
        fail("homepage: site JSON-LD is not valid JSON");
      }
      if (data) {
        if (data["@context"] !== "https://schema.org") {
          fail("homepage: JSON-LD context");
        }
        if (JSON.stringify(data).includes("SearchAction")) {
          fail("homepage: SearchAction must not be advertised");
        }
        const graph = Array.isArray(data["@graph"]) ? data["@graph"] : [];
        const types = new Set(graph.map((node) => node["@type"]));
        if (!types.has("WebSite")) fail("homepage: JSON-LD WebSite is missing");
        if (!types.has("Organization")) fail("homepage: JSON-LD Organization is missing");
        const website = graph.find((node) => node["@type"] === "WebSite");
        const organization = graph.find((node) => node["@type"] === "Organization");
        if (website) {
          if (website.name !== SITE_NAME) fail("homepage: WebSite name");
          if (website.url !== `${SITE_ORIGIN}/`) fail("homepage: WebSite url");
          if (website.inLanguage !== "zh-CN") fail("homepage: WebSite inLanguage");
          if (!website.description) fail("homepage: WebSite description");
        }
        if (organization) {
          if (organization.name !== SITE_NAME) fail("homepage: Organization name");
          if (organization.url !== `${SITE_ORIGIN}/`) fail("homepage: Organization url");
        }
      }
    }

    if (/<script[^>]+src="https?:[^"]+"/i.test(home)) {
      fail("homepage: loads a cross-origin script");
    }
    if (/<link[^>]+rel="stylesheet"[^>]+href="https?:[^"]+"/i.test(home)) {
      fail("homepage: loads a cross-origin stylesheet");
    }
    const assets = [
      ...home.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
    ].map((match) => match[1]);
    if (assets.length === 0) fail("homepage: no local bundle assets referenced");
    for (const asset of assets) {
      try {
        await stat(join(dist, ...asset.slice(1).split("/")));
        stats.homepageAssets += 1;
      } catch {
        fail(`homepage: referenced asset is missing — ${asset}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats,
    buildDate,
  };
}

function printStats(stats) {
  console.log(`origin       ${stats.origin}`);
  console.log(`build date   ${stats.buildDate || "—"}`);
  console.log(`ok   page files — ${stats.pages}/${stats.expectedPages}`);
  console.log(`ok   titles / canonical — ${stats.canonical}/${stats.expectedPages}`);
  console.log(`ok   JSON-LD Article — ${stats.jsonLd}/${stats.expectedPages}`);
  console.log(
    `ok   evidence links — ${stats.evidenceLinks} across ${stats.expectedPages} pages`
  );
  console.log(
    `ok   citations / source counts — ${stats.citations}/${stats.expectedPages} · ${stats.sourceCounts}/${stats.expectedPages}`
  );
  console.log(`ok   internal links — ${stats.internalLinks}`);
  console.log(`ok   sitemap — ${stats.sitemapUrls} urls`);
  console.log("ok   robots.txt — sitemap declared");
  console.log(`ok   homepage — WebSite + Organization, ${stats.homepageAssets} local assets`);
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex !== -1 ? process.argv[rootIndex + 1] : undefined;
  const result = await checkPages({ root });
  printStats(result.stats);
  if (result.ok) {
    console.log("Static page check passed.");
  } else {
    for (const message of result.errors.slice(0, 30)) console.error(`fail ${message}`);
    if (result.errors.length > 30) {
      console.error(`fail … ${result.errors.length - 30} more`);
    }
    console.error(`Static page check failed (${result.errors.length} issues).`);
    process.exitCode = 1;
  }
}
