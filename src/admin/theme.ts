export type Theme = "dark" | "light";

/**
 * Theme selection: one attribute on `<html>`, remembered across visits, and
 * mirrored to the browser's own chrome colour.
 *
 * The *first* paint is handled by an inline script in `admin.html`, not here —
 * a React effect runs after the dark palette has already been painted, and a
 * flash of the wrong theme is the one thing a toggle must not do. This module
 * therefore only reads what that script decided and writes later changes.
 */

const STORAGE_KEY = "aihist.admin.theme";

/** Kept in sync with the inline script in `admin.html`. */
const CHROME: Record<Theme, string> = { dark: "#0f1116", light: "#f5f6f8" };

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", CHROME[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode, embedded webview). The theme still
    // applies for this page; it just will not survive a reload.
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
