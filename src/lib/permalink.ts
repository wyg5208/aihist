const PARAM = "e";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readEventSlug(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return value && SLUG_RE.test(value) ? value : null;
}

/**
 * Keep the address bar in step with the open entry without adding history
 * entries for every expand/collapse.
 */
export function writeEventSlug(slug: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set(PARAM, slug);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function eventUrl(slug: string, absolute = false): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(PARAM, slug);
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

/** Flat file: the host does not resolve directory indexes. */
export function staticPagePath(slug: string): string {
  return `/e/${slug}.html`;
}

export function staticPageUrl(slug: string, absolute = true): string {
  const path = staticPagePath(slug);
  if (!absolute || typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}
