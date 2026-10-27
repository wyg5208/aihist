import { useCallback, useSyncExternalStore } from "react";
import { applyTheme, currentTheme, subscribeTheme, type Theme } from "../lib/theme";

/**
 * The palette is already on `<html>` before React mounts (see `index.html`), so
 * this hook reads that attribute instead of deciding a second time. It is a
 * subscription rather than local state because the theme also picks the layout:
 * the switcher and the shell that draws the view must re-render together.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
  }, []);

  return { theme, setTheme };
}
