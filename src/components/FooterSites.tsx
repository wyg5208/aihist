import { SISTER_SITES } from "../lib/sisterSites";

type Tone = "aurora" | "editorial" | "museum";

/**
 * The "相关站点" line that closes every public footer. Each layout keeps its own
 * palette, so only the border and text colours are handed in; the structure and
 * the outbound-link contract (new tab, noopener) stay identical across themes.
 */
const TONES: Record<
  Tone,
  { rule: string; label: string; chip: string; name: string; domain: string }
> = {
  aurora: {
    rule: "border-[var(--rule)]",
    label: "text-[var(--muted)]",
    chip: "border-[var(--rule)] bg-[rgba(255,255,255,.03)] hover:border-[var(--rule-strong)]",
    name: "text-[var(--ink)]",
    domain: "text-[var(--muted)]",
  },
  editorial: {
    rule: "border-[#2a3a4d]",
    label: "text-[var(--accent-mark)]",
    chip: "border-[#33465c] hover:border-[#8d949f]",
    name: "text-[#f6efe1]",
    domain: "text-[#8d949f]",
  },
  museum: {
    rule: "border-[#26463a]",
    label: "text-[var(--accent-mark)]",
    chip: "border-[#345445] hover:border-[#8aa392]",
    name: "text-[#f4eeda]",
    domain: "text-[#8d9c92]",
  },
};

export function FooterSites({
  tone,
  className = "",
}: {
  tone: Tone;
  className?: string;
}) {
  const colors = TONES[tone];

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t pt-4 ${colors.rule} ${className}`}
    >
      <span
        className={`mr-1 font-mono text-[10.5px] uppercase tracking-[0.18em] ${colors.label}`}
      >
        相关站点
      </span>
      {SISTER_SITES.map((site) => (
        <a
          key={site.id}
          href={site.href}
          target="_blank"
          rel="noopener noreferrer"
          title={site.tagline}
          aria-label={`${site.name} · ${site.tagline}（新标签页打开）`}
          className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${colors.chip}`}
        >
          <span className={`font-semibold ${colors.name}`}>{site.name}</span>
          <span className={`font-mono text-[10.5px] tracking-[0.02em] ${colors.domain}`}>
            {site.domain}
          </span>
          <span
            aria-hidden="true"
            className="transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          >
            ↗
          </span>
        </a>
      ))}
    </div>
  );
}
