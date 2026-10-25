import { formatCount } from "../format";

/**
 * Four chart shapes, hand-rolled SVG.
 *
 * A charting library would add ~90kB to a bundle that renders behind a login and
 * gets four kinds of picture: a line, a bar list, a stacked bar and a sparkline.
 * The existing `CadenceSpark` already proved the approach. These components keep
 * the same division of labour: the caller supplies numbers and labels, this file
 * owns nothing but geometry.
 */

export interface Series {
  key: string;
  label: string;
  values: number[];
  tone?: string;
}

const TONES = ["var(--c-accent)", "var(--c-info)", "var(--c-ok)", "var(--c-warn)"];

function niceMax(values: number[]): number {
  const peak = Math.max(1, ...values.filter((value) => Number.isFinite(value)));
  if (peak <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const normalised = peak / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

interface LineChartProps {
  series: Series[];
  labels: string[];
  height?: number;
  /** Treat the y-axis as percentages (0–1 values). */
  unit?: string;
}

export function LineChart({ series, labels, height = 170, unit = "" }: LineChartProps) {
  const width = 720;
  const pad = { top: 12, right: 10, bottom: 20, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = series[0]?.values.length ?? 0;
  const max = niceMax(series.flatMap((item) => item.values));
  const stepX = points > 1 ? plotW / (points - 1) : 0;

  const x = (index: number) => pad.left + index * stepX;
  const y = (value: number) => pad.top + plotH - (Math.max(0, value) / max) * plotH;

  const ticks = [0, 0.5, 1];
  const tickIndexes =
    points <= 1
      ? [0]
      : Array.from(new Set([0, Math.floor((points - 1) / 2), points - 1]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={series
        .map((item) => `${item.label}：${item.values.join("、")}`)
        .join("；")}
    >
      {ticks.map((fraction) => {
        const lineY = pad.top + plotH - fraction * plotH;
        return (
          <g key={fraction}>
            <line
              x1={pad.left}
              y1={lineY}
              x2={width - pad.right}
              y2={lineY}
              stroke="var(--c-line)"
              strokeWidth="1"
              strokeDasharray={fraction === 0 ? undefined : "3 4"}
            />
            <text
              x={pad.left - 8}
              y={lineY + 3.5}
              textAnchor="end"
              fill="var(--c-text-mute)"
              style={{ font: "9px var(--font-mono)" }}
            >
              {formatCount(Math.round(max * fraction))}
            </text>
          </g>
        );
      })}

      {series.map((item, index) => {
        const tone = item.tone ?? TONES[index % TONES.length];
        const path = item.values
          .map((value, position) => `${position === 0 ? "M" : "L"}${x(position)},${y(value)}`)
          .join(" ");
        return (
          <g key={item.key}>
            <path d={path} fill="none" stroke={tone} strokeWidth="1.6" strokeLinejoin="round" />
            {item.values.map((value, position) =>
              value === 0 ? null : (
                <circle key={position} cx={x(position)} cy={y(value)} r="1.9" fill={tone}>
                  <title>{`${labels[position] ?? ""} · ${item.label} ${formatCount(value)}${unit}`}</title>
                </circle>
              ),
            )}
          </g>
        );
      })}

      {tickIndexes.map((index) => (
        <text
          key={index}
          x={x(index)}
          y={height - 6}
          textAnchor={index === 0 ? "start" : index === points - 1 ? "end" : "middle"}
          fill="var(--c-text-mute)"
          style={{ font: "9px var(--font-mono)" }}
        >
          {labels[index] ?? ""}
        </text>
      ))}
    </svg>
  );
}

export function Sparkline({
  values,
  height = 34,
  tone = "var(--c-accent)",
}: {
  values: number[];
  height?: number;
  tone?: string;
}) {
  const width = 120;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const path = values
    .map((value, index) => {
      const px = index * step;
      const py = height - 2 - (Math.max(0, value) / max) * (height - 4);
      return `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" aria-hidden="true">
      <path d={path} fill="none" stroke={tone} strokeWidth="1.2" />
    </svg>
  );
}

export interface BarItem {
  label: string;
  value: number;
  hint?: string;
}

/**
 * Horizontal bars in DOM, not SVG: the labels here are Chinese words of variable
 * width, and letting the browser lay them out beats estimating glyph widths.
 */
export function BarList({
  items,
  tone = "var(--c-accent)",
  emptyLabel = "暂无数据",
}: {
  items: BarItem[];
  tone?: string;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-[var(--c-text-mute)]">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,7rem)_1fr_3.5rem] items-center gap-2">
          <span className="truncate text-[11px] text-[var(--c-text-dim)]" title={item.hint ?? item.label}>
            {item.label}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-[var(--c-surface-2)]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: tone }}
            />
          </span>
          <span className="num text-right text-[11px] text-[var(--c-text)]">
            {formatCount(item.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface Segment {
  label: string;
  value: number;
  tone: string;
}

/** A single stacked bar plus a legend; enough for verdict ratios. */
export function StackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return <div className="h-2 rounded-full bg-[var(--c-surface-2)]" />;
  }
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--c-surface-2)]">
        {segments.map((segment) =>
          segment.value === 0 ? null : (
            <span
              key={segment.label}
              title={`${segment.label} ${segment.value}`}
              style={{ width: `${(segment.value / total) * 100}%`, background: segment.tone }}
            />
          ),
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-[10px] text-[var(--c-text-mute)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: segment.tone }} />
            {segment.label}
            <span className="num text-[var(--c-text-dim)]">{formatCount(segment.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
