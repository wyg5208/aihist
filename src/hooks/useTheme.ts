import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  currentTheme,
  storedTheme,
  systemTheme,
  toggleTheme,
  type Theme,
} from "../lib/theme";

/**
 * The palette is already on `<html>` before React mounts (see `index.html`), so
 * this hook starts from that attribute instead of deciding a second time. The
 * media query only matters while the reader has made no explicit choice.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (storedTheme()) return;
      setTheme(applyTheme(systemTheme(), false));
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  const toggle = useCallback(() => setTheme(toggleTheme()), []);

  return { theme, toggle };
}
