import { useId } from "react";

/**
 * 电路竹简：四条竖简、一道走线穿过、四个穿孔、两端端子。
 *
 * The geometry is the one used by `demos/logo/a-circuit` — a 64x64 grid where
 * the cord passes behind the slips and the holes are punched through them, so
 * the cord shows inside each slip. Every colour is a theme token, which is why
 * one component serves all three editions:
 *
 *   slips   currentColor      (the text colour of the surrounding lockup)
 *   cord    --accent          the reading accent: copper / cyan / gold
 *   accent  --accent-mark     the decorative tint of the third slip
 *
 * Sizes are not scaled copies. Below 32px the cord is the first casualty: at
 * 26px the seam is 1.6px wide and the cord 2.9px tall, so the stretches that
 * show between the slips read as copper blocks and the whole mark as a grille
 * with a bar through it. `micro` therefore keeps the four slips only — wider
 * (11 units), nearer together, no holes, no terminals, no cord — and the lockup
 * reads as four spines with the third one tinted. Above 256px the sixteen pins
 * return. The thresholds match the spec sheet.
 */

type MarkVariant = "flat" | "glow" | "seal";

interface BrandMarkProps {
  /** Rendered box in CSS pixels. Picks the geometry tier. */
  size?: number;
  /** `onDeep` for the dark footer wells, where currentColor flips to light. */
  tone?: "current" | "onDeep";
  /**
   * flat  editorial — plain ink, no chrome
   * glow  aurora    — keeps the halo the old orb had
   * seal  museum    — keeps the square seal frame, mark replaces the 纪年 glyphs
   */
  variant?: MarkVariant;
  className?: string;
}

interface Geometry {
  bars: number[];
  barW: number;
  barY: number;
  barH: number;
  radius: number;
  accentIndex: number;
  holes: { cy: number; r: number } | null;
  cord: { x: number; y: number; w: number; h: number } | null;
  terminal: { w: number; h: number; y: number; left: number; right: number } | null;
}

const STANDARD: Geometry = {
  bars: [9.5, 21.5, 33.5, 45.5],
  barW: 9,
  barY: 11,
  barH: 42,
  radius: 4.5,
  accentIndex: 2,
  holes: { cy: 30, r: 3 },
  cord: { x: 3, y: 27.8, w: 58, h: 4.4 },
  terminal: { w: 5.5, h: 5.5, y: 27.25, left: 0.5, right: 58 },
};

const MICRO: Geometry = {
  bars: [4, 19, 34, 49],
  barW: 11,
  barY: 10,
  barH: 44,
  radius: 5.5,
  accentIndex: 2,
  holes: null,
  cord: null,
  terminal: null,
};

const PINS = { w: 2, h: 6, offset: [1.8, 5.2], y: 52 };

export function BrandMark({
  size = 26,
  tone = "current",
  variant = "flat",
  className = "",
}: BrandMarkProps) {
  // Two marks share a page (header and footer); a bare id would collide.
  const maskId = `brand-holes-${useId().replace(/[:]/g, "")}`;
  const g = size < 32 ? MICRO : STANDARD;
  const detail = size >= 256;

  const slips = g.bars.map((x, i) => (
    <rect
      key={x}
      x={x}
      y={g.barY}
      width={g.barW}
      height={g.barH}
      rx={g.radius}
      fill={i === g.accentIndex ? "var(--accent-mark)" : "currentColor"}
    />
  ));

  return (
    <span
      className={`brand-mark brand-mark--${variant} ${className}`.trim()}
      style={{ width: size, height: size, color: tone === "onDeep" ? "var(--on-deep)" : undefined }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" fill="none">
        {g.holes && (
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
              <rect width="64" height="64" fill="#fff" />
              {g.bars.map((x) => (
                <circle key={x} cx={x + g.barW / 2} cy={g.holes!.cy} r={g.holes!.r} fill="#000" />
              ))}
            </mask>
          </defs>
        )}
        {detail &&
          g.bars.map((x, i) =>
            PINS.offset.map((o) => (
              <rect
                key={`${x}-${o}`}
                x={x + o}
                y={PINS.y}
                width={PINS.w}
                height={PINS.h}
                rx={PINS.w / 2}
                fill={i === g.accentIndex ? "var(--accent-mark)" : "currentColor"}
              />
            )),
          )}
        {g.cord && (
          <rect x={g.cord.x} y={g.cord.y} width={g.cord.w} height={g.cord.h} fill="var(--accent)" />
        )}
        {g.terminal && (
          <>
            <rect
              x={g.terminal.left}
              y={g.terminal.y}
              width={g.terminal.w}
              height={g.terminal.h}
              fill="currentColor"
            />
            <rect
              x={g.terminal.right}
              y={g.terminal.y}
              width={g.terminal.w}
              height={g.terminal.h}
              fill="currentColor"
            />
          </>
        )}
        {g.holes ? <g mask={`url(#${maskId})`}>{slips}</g> : slips}
      </svg>
    </span>
  );
}
