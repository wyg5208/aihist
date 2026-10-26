export type Theme = "dark" | "light";

/**
 * Theme selection for the public archive: one attribute on `<html>` picks the
 * palette, an explicit choice is remembered, and until one is made the page
 * follows the operating system.
 *
 * The *first* paint is handled by the inline script in `index.html` — a React
 * effect runs after the palette has already been painted, and a flash of the
 * wrong theme is the one thing a toggle must not do. This module therefore only
 * reads what that script decided and writes later changes. The storage key and
 * the two chrome colours are duplicated there on purpose; keep them in sync.
 */

const STORAGE_KEY = "aihist.theme";

const CHROME: Record<Theme, string> = { dark: "#14120f", light: "#f6f2e9" };

export function storedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * `persist: false` is for following the system: the reader made no choice, so
 * nothing should be remembered that would survive a change of preference.
 */
export function applyTheme(theme: Theme, persist = true): Theme {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", CHROME[theme]);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be blocked (private mode, embedded webview). The theme still
      // applies for this page; it just will not survive a reload.
    }
  }
  return theme;
}

export function toggleTheme(): Theme {
  return applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
