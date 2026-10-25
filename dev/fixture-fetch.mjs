import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES } from "../functions/lib/sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const upstream = join(here, "fixtures", "upstream");

const FILES = {
  openrouter: "openrouter.json",
  "hf-trending": "hf-trending.json",
  "hf-textgen": "hf-textgen.json",
  arxiv: "arxiv.xml",
  "hn-llm": "hn-llm.json",
  "hn-ai": "hn-ai.json",
  openai: "openai.rss.xml",
  google: "google.rss.xml",
  anthropic: "anthropic.sitemap.xml",
  "hf-blog": "hf-blog.rss.xml",
  techcrunch: "techcrunch.rss.xml",
  verge: "verge.atom.xml",
  mittr: "mittr.rss.xml",
  qbitai: "qbitai.rss.xml",
  infoq: "infoq.rss.xml",
  tmtpost: "tmtpost.rss.xml",
  leiphone: "leiphone.rss.xml",
};

function sourceKeyFor(url) {
  const exact = SOURCES.find((source) => source.url === url);
  if (exact) return exact.key;
  if (url.includes("hn.algolia.com")) {
    return decodeURIComponent(url).includes("query=LLM") ? "hn-llm" : "hn-ai";
  }
  return null;
}

const cache = new Map();

export async function fixtureFetch(url) {
  const key = sourceKeyFor(url);
  const file = key ? FILES[key] : null;
  if (!file) {
    return {
      ok: false,
      status: 404,
      url,
      headers: new Headers(),
      text: async () => "",
    };
  }
  if (!cache.has(file)) {
    cache.set(file, await readFile(join(upstream, file), "utf8"));
  }
  const body = cache.get(file);
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({
      "content-type": file.endsWith(".json") ? "application/json" : "application/xml",
      "content-length": String(Buffer.byteLength(body)),
    }),
    text: async () => body,
  };
}
