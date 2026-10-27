export type Theme = "editorial" | "aurora" | "museum";

export interface ThemeMeta {
  id: Theme;
  label: string;
  /** One line naming the edition, used in the tooltip and the switcher copy. */
  hint: string;
  /** Browser chrome colour (`<meta name="theme-color">`). */
  chrome: string;
}

/**
 * Three editions of the same archive, chosen by the reader. The theme picks the
 * layout as well as the palette, so these are whole pages, not skins:
 *
 *   典藏 editorial  a printed scroll — ink strip, newspaper rows, copper rule
 *   极光 aurora     the night console — glass header, bento figures, cyan light
 *   博物馆 museum   a catalogue — green notice, year scrubber, two-column cards
 *
 * The *first* paint is handled by the inline script in `index.html` — a React
 * effect runs after the palette has already been painted, and a flash of the
 * wrong edition is the one thing a switcher must not do. This module therefore
 * only reads what that script decided and writes later changes. The storage key
 * and the three chrome colours are duplicated there on purpose; keep them in
 * sync.
 */

export const THEMES: ThemeMeta[] = [
  { id: "editorial", label: "典藏", hint: "典藏卷轴 · 米纸、墨蓝、铜金", chrome: "#faf7f0" },
  { id: "aurora", label: "极光", hint: "深色极光 · 夜间终端、青与紫", chrome: "#06070d" },
  { id: "museum", label: "博物馆", hint: "博物馆暖调 · 亚麻纸、森林绿、金", chrome: "#f4f0e5" },
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
  if (typeof document === "undefined") return "editorial";
  const active = document.documentElement.dataset.theme;
  return isTheme(active) ? active : "editorial";
}

/**
 * One store, many readers. The layout follows the palette, so the switcher in
 * the header and the shell that renders the view must see the same value — a
 * `useState` per component would repaint `data-theme` and leave the page on the
 * old edition until a reload.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let watchingSystem = false;

function emit() {
  for (const listener of listeners) listener();
}

function watchSystem() {
  if (watchingSystem || typeof window === "undefined") return;
  watchingSystem = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (storedTheme()) return;
    applyTheme(systemTheme(), false);
  });
}

export function subscribeTheme(listener: Listener): () => void {
  watchSystem();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `persist: false` is for following the system: the reader made no choice, so
 * nothing should be remembered that would survive a change of preference.
 */
export function applyTheme(theme: Theme, persist = true): Theme {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", metaFor(theme).chrome);
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be blocked (private mode, embedded webview). The theme still
      // applies for this page; it just will not survive a reload.
    }
  }
  emit();
  return theme;
}
