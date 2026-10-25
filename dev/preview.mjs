/**
 * Local harness: real Function handler + recorded upstream + in-memory data.
 *
 *   node dev/preview.mjs 8000
 *
 * Vite proxies /functions/v1/app here. The in-memory database resets whenever
 * this process restarts; it is not a substitute for the deployed database.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApp } from "../functions/handler.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { PANEL_ENV, panelFetch } from "./fake-panel.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const port = Number(process.argv[2] || 8000);
const supabase = createFakeSupabase();
// Offline stand-in for the three judges. "mixed" rejects news-shaped titles so
// the preview exercises the same gate as production; no real key is used.
const panel = {
  env: { ...process.env, ...PANEL_ENV },
  fetch: panelFetch({ mode: "mixed" }),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

async function requestOf(req) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (typeof value === "string") headers.set(key, value);
  }
  const method = req.method || "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}

async function send(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

async function serveStatic(res, pathname) {
  let target = join(dist, normalize(pathname));
  if (!target.startsWith(dist)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
  } catch {
    target = join(dist, "index.html");
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] || "application/octet-stream",
      "cache-control": target.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("dist/ is empty — run npm run build, or open the Vite dev server.");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/functions/v1/app")) {
      const request = await requestOf(req);
      const response = await handleApp({
        request,
        supabase,
        runtime: { env: panel.env, fetch: panel.fetch },
      });
      await send(res, response);
      return;
    }
    if (url.pathname === "/__state") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          events: supabase.tables.events.length,
          rawItems: supabase.tables.raw_items.length,
          runs: supabase.tables.sync_runs.length,
          state: supabase.tables.sync_state[0] || null,
        })
      );
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("[preview]", error?.code || error?.message || "internal_error");
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local function harness → http://127.0.0.1:${port}/functions/v1/app`);
  console.log(`upstream: recorded fixtures · database: in-memory · judges: offline panel`);
});
