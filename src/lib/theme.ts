export type Theme = "editorial" | "aurora" | "museum";

export interface ThemeMeta {
  id: Theme;
  label: string;
  /** One line describing the palette, used in the tooltip and the switcher copy. */
  hint: string;
  /** Browser chrome colour (`<meta name="theme-color">`). */
  chrome: string;
}

/**
 * Three readings of the same archive, chosen by the reader.
 *
 *   典藏 editorial  paper, ink-blue ground, copper rule — the archival default
 *   极光 aurora     night ground, cyan and violet light — for reading at night
 *   博物馆 museum   linen, forest green, gold — the warm, printed-catalogue voice
 *
 * The *first* paint is handled by the inline script in `index.html` — a React
 * effect runs after the palette has already been painted, and a flash of the
 * wrong theme is the one thing a switcher must not do. This module therefore
 * only reads what that script decided and writes later changes. The storage key
 * and the three chrome colours are duplicated there on purpose; keep them in
 * sync.
 */

export const THEMES: ThemeMeta[] = [
  { id: "editorial", label: "典藏", hint: "米纸 · 墨蓝 · 铜金", chrome: "#faf7f0" },
  { id: "aurora", label: "极光", hint: "夜间底色 · 青与紫光", chrome: "#06070d" },
  { id: "museum", label: "博物馆", hint: "亚麻纸 · 森林绿 · 金", chrome: "#f4f0e5" },
];

const STORAGE_KEY = "aihist.theme";

/**
 * Before there were three palettes the key held `light` / `dark`. Those readers
 * made a real choice once, so map it onto the closest of the three instead of
 * silently resetting them to the default.
 */
const LEGACY: Record<string, Theme> = { light: "editorial", dark: "aurora" };

export function isTheme(value: unknown): value is Theme {
  return value === "editorial" || value === "aurora" || value === "museum";
}

export function metaFor(theme: Theme): ThemeMeta {
  return THEMES.find((item) => item.id === theme) ?? THEMES[0];
}

export function storedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) return saved;
    return saved ? LEGACY[saved] ?? null : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "aurora" : "editorial";
}

export function currentTheme(): Theme {
  const active = document.documentElement.dataset.theme;
  return isTheme(active) ? active : "editorial";
}

/**
 * `persist: false` is for following the system: the reader made no choice, so
 * nothing should be remembered that would survive a change of preference.
 */
export function applyTheme(theme: Theme, persist = true): Theme {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", metaFor(theme).chrome);
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
