import { decodeEntities, htmlToText } from "./http.mjs";

/**
 * Every outbound request is built from these constants. The browser never
 * supplies a URL, and every redirect is re-checked against this host list.
 */
export const ALLOWED_HOSTS = new Set([
  "openrouter.ai",
  "huggingface.co",
  "export.arxiv.org",
  "arxiv.org",
  "hn.algolia.com",
  "openai.com",
  "blog.google",
  "www.anthropic.com",
  "techcrunch.com",
  "www.theverge.com",
  "www.technologyreview.com",
  "www.qbitai.com",
  "www.leiphone.com",
  "www.tmtpost.com",
  "www.infoq.cn",
]);

/** source families drive cross-validation and the confidence score */
export const FAMILY_LABELS = {
  openrouter: "模型目录",
  huggingface: "开源模型库",
  arxiv: "论文预印本",
  official: "官方公告",
  community: "社区讨论",
  media: "媒体报道",
};

const ARXIV_QUERY = [
  "cat:cs.AI",
  "cat:cs.CL",
  "cat:cs.LG",
  "cat:cs.MA",
  "cat:cs.RO",
].join("+OR+");

function hnUrl(query, days) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return (
    "https://hn.algolia.com/api/v1/search_by_date?tags=story" +
    `&query=${encodeURIComponent(query)}` +
    `&numericFilters=points%3E120,created_at_i%3E${since}` +
    "&hitsPerPage=50"
  );
}

export const SOURCES = [
  {
    key: "openrouter",
    family: "openrouter",
    name: "OpenRouter",
    kind: "openrouter",
    url: "https://openrouter.ai/api/v1/models",
    timeout: 7000,
  },
  {
    key: "arxiv",
    family: "arxiv",
    name: "arXiv",
    kind: "arxiv",
    url:
      "https://export.arxiv.org/api/query?search_query=" +
      ARXIV_QUERY +
      "&sortBy=submittedDate&sortOrder=descending&max_results=30",
    timeout: 7000,
  },
  {
    key: "qbitai",
    family: "media",
    name: "量子位",
    kind: "feed",
    url: "https://www.qbitai.com/feed",
    timeout: 7000,
    domestic: true,
    aiOnly: true,
  },
  {
    key: "infoq",
    family: "media",
    name: "InfoQ 中国",
    kind: "feed",
    url: "https://www.infoq.cn/feed",
    timeout: 7000,
    domestic: true,
    aiOnly: true,
  },
  {
    key: "tmtpost",
    family: "media",
    name: "钛媒体",
    kind: "feed",
    url: "https://www.tmtpost.com/rss",
    timeout: 7000,
    domestic: true,
    aiOnly: true,
  },
  {
    key: "leiphone",
    family: "media",
    name: "雷峰网",
    kind: "feed",
    url: "https://www.leiphone.com/feed",
    timeout: 7000,
    domestic: true,
    aiOnly: true,
  },
  {
    key: "hn-llm",
    family: "community",
    name: "Hacker News · LLM",
    kind: "hn",
    url: hnUrl("LLM", 14),
    timeout: 7000,
  },
  {
    key: "hn-ai",
    family: "community",
    name: "Hacker News · AI",
    kind: "hn",
    url: hnUrl("AI", 14),
    timeout: 7000,
  },
  {
    key: "openai",
    family: "official",
    name: "OpenAI News",
    kind: "feed",
    url: "https://openai.com/news/rss.xml",
    timeout: 7000,
  },
  {
    key: "google",
    family: "official",
    name: "Google AI Blog",
    kind: "feed",
    url: "https://blog.google/technology/ai/rss/",
    timeout: 7000,
  },
  {
    key: "anthropic",
    family: "official",
    name: "Anthropic News",
    kind: "sitemap",
    url: "https://www.anthropic.com/sitemap.xml",
    timeout: 7000,
  },
  {
    key: "techcrunch",
    family: "media",
    name: "TechCrunch AI",
    kind: "feed",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    timeout: 7000,
  },
  {
    key: "verge",
    family: "media",
    name: "The Verge AI",
    kind: "feed",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    timeout: 7000,
  },
  {
    key: "mittr",
    family: "media",
    name: "MIT Technology Review AI",
    kind: "feed",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
    timeout: 7000,
  },
  // Hugging Face endpoints are the slowest at the edge. They run last so a
  // timeout cannot consume the fetch slots that the faster feeds need.
  {
    key: "hf-blog",
    family: "official",
    name: "Hugging Face Blog",
    kind: "feed",
    url: "https://huggingface.co/blog/feed.xml",
    timeout: 7000,
  },
  {
    key: "hf-trending",
    family: "huggingface",
    name: "Hugging Face Trending",
    kind: "hf",
    url: "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=60",
    timeout: 7000,
  },
  {
    key: "hf-textgen",
    family: "huggingface",
    name: "Hugging Face 文本生成",
    kind: "hf",
    url: "https://huggingface.co/api/models?sort=likes&direction=-1&filter=text-generation&limit=40",
    timeout: 7000,
  },
];

export const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

const MAX_BODY_BYTES = 3 * 1024 * 1024;

function hostAllowed(url) {
  try {
    return ALLOWED_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function tagged(block, names) {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = re.exec(block);
    if (match) {
      const value = decodeEntities(match[1]).trim();
      if (value) return value;
    }
  }
  return "";
}

function attr(block, tag, name) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${name}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i");
  const match = re.exec(block);
  return match ? decodeEntities(match[1]).trim() : "";
}

function parseDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function pickLink(block) {
  const atom = /<link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*>/i.exec(block);
  if (atom) {
    const href = attr(atom[0] + ">", "link", "href");
    if (href) return href;
  }
  const anyHref = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i.exec(block);
  if (anyHref) {
    const href = decodeEntities(anyHref[1]).trim();
    if (href) return href;
  }
  const plain = tagged(block, ["link"]);
  if (plain) return plain;
  const guid = tagged(block, ["guid", "id"]);
  return /^https?:\/\//i.test(guid) ? guid : "";
}

/** RSS 2.0 and Atom both end up here. */
export function parseFeed(xml) {
  if (typeof xml !== "string" || xml.length < 40) return [];
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ]
    .map((m) => m[0])
    .slice(0, 120);

  const out = [];
  for (const block of blocks) {
    const title = htmlToText(tagged(block, ["title"]), 300);
    if (!title) continue;
    const url = pickLink(block);
    const summary = htmlToText(
      tagged(block, ["description", "summary", "content:encoded", "content"]),
      600
    );
    const date =
      parseDate(tagged(block, ["pubDate", "published", "updated", "dc:date", "date"])) ??
      null;
    const externalId =
      tagged(block, ["guid", "id"]) || url || `${title}|${date ?? ""}`;
    out.push({ title, url, summary, publishedAt: date, externalId });
  }
  return out;
}

export function parseSitemap(xml, pathPattern = "/news/") {
  if (typeof xml !== "string") return [];
  const out = [];
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = match[1];
    const loc = tagged(block, ["loc"]);
    if (!loc || !loc.includes(pathPattern)) continue;
    const lastmod = parseDate(tagged(block, ["lastmod"]));
    const slug = loc.split("/").filter(Boolean).pop() ?? loc;
    const title = slug
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    out.push({ title, url: loc, summary: "", publishedAt: lastmod, externalId: loc });
  }
  return out;
}

export function parseOpenRouter(json) {
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .filter((m) => m && typeof m.id === "string")
    .map((m) => ({
      id: m.id,
      canonicalSlug: m.canonical_slug || m.id,
      name: m.name || m.id,
      created: m.created ? new Date(m.created * 1000).toISOString() : null,
      contextLength: Number.isFinite(m.context_length) ? m.context_length : null,
      modality: m.architecture?.modality || "",
      description: typeof m.description === "string" ? m.description : "",
      huggingFaceId: m.hugging_face_id || null,
      inputModalities: Array.isArray(m.architecture?.input_modalities)
        ? m.architecture.input_modalities
        : [],
    }));
}

export function parseHf(json) {
  const list = Array.isArray(json) ? json : [];
  return list
    .filter((m) => m && typeof m.id === "string")
    .map((m) => ({
      id: m.id,
      author: m.author || m.id.split("/")[0] || "",
      createdAt: parseDate(m.createdAt),
      likes: Number(m.likes) || 0,
      downloads: Number(m.downloads) || 0,
      trendingScore: Number(m.trendingScore) || 0,
      tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === "string") : [],
      pipelineTag: m.pipeline_tag || "",
    }));
}

export function parseArxiv(xml) {
  if (typeof xml !== "string") return [];
  const out = [];
  for (const match of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const block = match[0];
    const rawId = tagged(block, ["id"]);
    const title = htmlToText(tagged(block, ["title"]), 400);
    if (!title || !rawId) continue;
    const url = /^https?:\/\//.test(rawId) ? rawId.replace(/^http:/, "https:") : "";
    const summary = htmlToText(tagged(block, ["summary"]), 2000);
    const publishedAt =
      parseDate(tagged(block, ["published"])) ?? parseDate(tagged(block, ["updated"]));
    const categories = [...block.matchAll(/<category\b[^>]*term=["']([^"']+)["']/gi)].map(
      (m) => m[1]
    );
    out.push({
      id: rawId,
      title,
      url,
      summary,
      publishedAt,
      categories,
      externalId: rawId,
    });
  }
  return out;
}

export function parseHn(json) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  const out = [];
  for (const hit of hits) {
    if (!hit || !hit.title) continue;
    const hnLink = `https://news.ycombinator.com/item?id=${hit.objectID}`;
    out.push({
      id: hit.objectID,
      title: htmlToText(hit.title, 300),
      url: typeof hit.url === "string" && /^https?:/i.test(hit.url) ? hit.url : hnLink,
      hnLink,
      summary: "",
      points: Number(hit.points) || 0,
      comments: Number(hit.num_comments) || 0,
      publishedAt: parseDate(hit.created_at),
      externalId: String(hit.objectID),
      author: hit.author || "",
    });
  }
  return out;
}

async function readLimited(response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error("body_too_large");
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("body_too_large");
  return text;
}

async function requestText(source, { fetchImpl, deadline, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), source.timeout);
  const signals = [controller.signal];
  if (signal) signals.push(signal);
  const combined = typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : controller.signal;
  const remaining = deadline - Date.now();
  const budgetTimer = setTimeout(() => controller.abort(), Math.max(250, remaining));
  try {
    const response = await fetchImpl(source.url, {
      redirect: "follow",
      signal: combined,
      headers: {
        accept: "application/json, application/xml, text/xml, application/atom+xml, */*",
        "user-agent": "AI-Chronicle/1.0 (+https://qoder.site)",
      },
    });
    if (!hostAllowed(response.url)) throw new Error("bad_redirect");
    if (!response.ok) throw new Error(`http_${response.status}`);
    return await readLimited(response);
  } finally {
    clearTimeout(timer);
    clearTimeout(budgetTimer);
  }
}

/**
 * Fetch and parse one source. Never throws: a broken upstream is reported as
 * a fixed error code and the rest of the run continues.
 */
export async function loadSource(source, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const deadline = options.deadline ?? Date.now() + source.timeout;
  if (Date.now() >= deadline) {
    return { key: source.key, family: source.family, name: source.name, ok: false, error: "deadline", items: [], ms: 0 };
  }
  const started = Date.now();
  try {
    const text = await requestText(source, { fetchImpl, deadline, signal: options.signal });
    let items = [];
    if (source.kind === "feed") items = parseFeed(text);
    else if (source.kind === "sitemap") items = parseSitemap(text);
    else if (source.kind === "arxiv") items = parseArxiv(text);
    else {
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("parse_error");
      }
      if (source.kind === "openrouter") items = parseOpenRouter(json);
      else if (source.kind === "hf") items = parseHf(json);
      else if (source.kind === "hn") items = parseHn(json);
    }
    if (!items.length) throw new Error("empty_source");
    return {
      key: source.key,
      family: source.family,
      name: source.name,
      kind: source.kind,
      url: source.url,
      domestic: Boolean(source.domestic),
      aiOnly: Boolean(source.aiOnly),
      ok: true,
      error: null,
      items,
      ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[a-z_]+$/.test(message) ? message : error?.name === "AbortError" ? "timeout" : "network";
    return {
      key: source.key,
      family: source.family,
      name: source.name,
      ok: false,
      error: code === "body_too_large" ? "too_large" : code,
      items: [],
      ms: Date.now() - started,
    };
  }
}

/** Run fetches with a small concurrency ceiling and a shared deadline. */
export async function loadSources(sources, options = {}) {
  const concurrency = options.concurrency ?? 4;
  const results = new Array(sources.length);
  let cursor = 0;
  async function worker() {
    while (cursor < sources.length) {
      const index = cursor++;
      results[index] = await loadSource(sources[index], options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return results;
}
