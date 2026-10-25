/**
 * The one beacon. Everything about it is best-effort.
 *
 * Rules it follows, in order of importance:
 *
 * 1. It can never break the page. Every call site is inside `try`/`catch` and
 *    every promise is swallowed.
 * 2. It sends nothing that identifies a person. No cookie, no fingerprint, no
 *    full referrer — only the referring host, plus two random ids the visitor
 *    can clear by clearing storage. The server hashes both with a per-day salt.
 * 3. It respects `doNotTrack`. If the browser says no, nothing is sent and no
 *    id is minted.
 * 4. It fires once per address. `?e=<slug>` is the only query the site uses, so
 *    "the address changed" and "the reader opened another entry" are the same
 *    event.
 *
 * The static reference pages (`/e/<slug>.html`) carry no JavaScript, so they
 * are not tracked here at all; the server reads those from the reverse proxy's
 * access log instead.
 */

const ENDPOINT = "/api/v1/track";
const VISITOR_KEY = "aihist.vid";
const SESSION_KEY = "aihist.sid";
const ID_LENGTH = 24;
// 64 symbols, so `byte % length` stays uniform.
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PATH = 300;

/** The last address sent in this page's lifetime; also the dedupe key. */
let lastSent = "";

function randomId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

/**
 * Read or mint an id. Storage can be unavailable (private mode, blocked
 * storage, an iframe with restrictive policies); in that case the visit is
 * still real, it just cannot be joined to another one.
 */
function stableId(area: () => Storage | null, key: string): string {
  try {
    const storage = area();
    if (!storage) return randomId();
    const existing = storage.getItem(key);
    if (existing && ID_RE.test(existing)) return existing;
    const minted = randomId();
    storage.setItem(key, minted);
    return minted;
  } catch {
    return randomId();
  }
}

function optOut(): boolean {
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  return nav.doNotTrack === "1" || nav.msDoNotTrack === "1";
}

function address(): string {
  return `${window.location.pathname}${window.location.search}`.slice(0, MAX_PATH) || "/";
}

function payload(path: string): string {
  return JSON.stringify({
    path,
    referrer: document.referrer || "",
    lang: (navigator.language || "").slice(0, 16),
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    sid: stableId(() => window.sessionStorage, SESSION_KEY),
    vid: stableId(() => window.localStorage, VISITOR_KEY),
  });
}

/** Record that this address was viewed. Safe to call on every render effect. */
export function trackPageView(): void {
  if (typeof window === "undefined") return;
  try {
    if (optOut()) return;
    const path = address();
    if (path === lastSent) return;
    lastSent = path;

    const body = payload(path);
    // `text/plain` keeps the request "simple": sendBeacon cannot complete a
    // preflight, and the API parses the JSON regardless of content type.
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }))) {
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "text/plain;charset=UTF-8" },
    }).catch(() => undefined);
  } catch {
    // A lost beacon is not worth a broken page.
  }
}
