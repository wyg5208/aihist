const noStore = { "cache-control": "no-store" };

export const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

export function fail(error, status, headers = {}) {
  return json({ ok: false, error }, status, headers);
}

export function cleanText(value, limit = 2000) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

const entities = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try { return String.fromCodePoint(Number.parseInt(dec, 10)); } catch { return ""; }
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name) =>
      Object.prototype.hasOwnProperty.call(entities, name.toLowerCase())
        ? entities[name.toLowerCase()]
        : match
    );
}

export function htmlToText(value, limit = 2000) {
  return cleanText(decodeEntities(value), limit);
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

export async function readJsonBody(request, maxBytes = 2048) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, error: "body_too_large" };
  }
  let text;
  try { text = await request.text(); } catch { return { ok: false, error: "invalid_body" }; }
  if (text.length > maxBytes) return { ok: false, error: "body_too_large" };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "invalid_body" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isoNow() {
  return new Date().toISOString();
}

export function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}
