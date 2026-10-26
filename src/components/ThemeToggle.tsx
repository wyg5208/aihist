import { useTheme } from "../hooks/useTheme";

/**
 * One control, two states, no icons: the masthead is set in monospace capitals
 * and a labelled switch reads better there than a sun/moon glyph. The label
 * names the theme the click leads to, so it answers "what happens next".
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const next = dark ? "浅色" : "深色";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={`切换到${next}主题`}
      title={`切换到${next}主题`}
      className="border border-[var(--rule)] px-1.5 py-px font-mono text-[9px] tracking-[0.14em] text-[var(--ink-soft)] transition-colors hover:border-[var(--rule-strong)] hover:text-[var(--accent)]"
    >
      {next}
    </button>
  );
}
