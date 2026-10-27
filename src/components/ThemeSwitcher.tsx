import { THEMES } from "../lib/theme";
import { useTheme } from "../hooks/useTheme";

/**
 * Three swatches, one press each, no dropdown: the palettes are the point, so
 * they are laid out rather than hidden behind a menu. The label stays on wide
 * screens and drops to the swatch alone on phones, where the header has no room
 * for three words — the tooltip and `aria-label` still name the target.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switcher" role="group" aria-label="切换配色主题">
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setTheme(item.id)}
          aria-pressed={theme === item.id}
          aria-label={`切换到${item.label}主题：${item.hint}`}
          title={`${item.label} · ${item.hint}`}
        >
          <span
            className="theme-swatch"
            data-theme-swatch={item.id}
            aria-hidden="true"
          />
          <span className="hidden lg:inline">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
