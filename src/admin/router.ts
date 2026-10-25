import { useEffect, useState } from "react";

/**
 * Hash routing, in about forty lines.
 *
 * The console is a separate bundle of five screens' worth of tables; pulling in
 * a router would add a dependency, a second history model and a bundle chunk for
 * behaviour that is entirely `location.hash`.
 *
 * The shape is `#/content?id=abc&status=hold`. Anything not starting with `#/`
 * collapses to the fallback so a hand-edited URL never renders a blank shell.
 */

export interface Route {
  /** `"content"` for `#/content`, `""` for the fallback route. */
  name: string;
  /** Nested segment, e.g. `#/content/3f2a` → `"3f2a"`. */
  tail: string;
  query: URLSearchParams;
}

export const HOME_ROUTE = "overview";

function parse(hash: string): Route {
  const raw = hash.startsWith("#/") ? hash.slice(2) : "";
  const [pathPart, queryPart = ""] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const name = segments[0] ?? "";
  return {
    name: name || HOME_ROUTE,
    tail: segments[1] ?? "",
    query: new URLSearchParams(queryPart),
  };
}

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function useHashRoute(): Route {
  const [hash, setHash] = useState(currentHash);

  useEffect(() => {
    const onChange = () => setHash(currentHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return parse(hash);
}

export interface NavigateOptions {
  /** Merge into the existing query instead of replacing it. */
  keep?: boolean;
  replace?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export function navigate(
  name: string,
  options: NavigateOptions = {},
): void {
  const base = options.keep ? parse(currentHash()) : null;
  const params = new URLSearchParams(base ? base.query.toString() : "");
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === null || value === undefined || value === "" || value === false) {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  const next = `#/${name}${search ? `?${search}` : ""}`;
  if (options.replace) {
    window.location.replace(next);
  } else {
    window.location.hash = next;
  }
}

/** Turn an alert `href` (`#/runs?limit=5`) into an in-app navigation. */
export function go(href: string): void {
  const target = href.startsWith("#") ? href : `#/${href.replace(/^\/+/, "")}`;
  if (target === currentHash()) {
    // Re-clicking the current alert should still feel alive: re-fire the event
    // that a real hash change would have produced.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = target;
}
