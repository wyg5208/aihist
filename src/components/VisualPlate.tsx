import type { ReactNode } from "react";
import { motifLabel, type PlateSpec } from "../lib/plate";

const VIEW_W = 1000;
const VIEW_H = 1240;

/**
 * 一屏一张「编年图版」。
 *
 * 只用几何、标线与年份水印，颜色全部来自主题令牌，所以它天然跟着典藏 /
 * 极光 / 博物馆三套皮肤走。这不是历史照片，也不伪装成照片：右下角永远写着
 * 「编年图版 No.xxx」，读者一眼知道自己在看什么。
 */
export function VisualPlate({ spec }: { spec: PlateSpec }) {
  return (
    <svg
      className="show-plate"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect width={VIEW_W} height={VIEW_H} fill="var(--plate-bg)" />

      <g className="show-plate-grid">
        {Array.from({ length: 15 }, (_, index) => (
          <line key={`v${index}`} x1={(index + 1) * 62.5} y1={0} x2={(index + 1) * 62.5} y2={VIEW_H} />
        ))}
        {Array.from({ length: 19 }, (_, index) => (
          <line key={`h${index}`} x1={0} y1={(index + 1) * 62} x2={VIEW_W} y2={(index + 1) * 62} />
        ))}
      </g>

      <rect
        x={26}
        y={26}
        width={VIEW_W - 52}
        height={VIEW_H - 52}
        fill="none"
        stroke="var(--plate-ink)"
        strokeOpacity={0.22}
      />

      <g transform={`translate(${VIEW_W / 2} ${430})`}>{motif(spec)}</g>

      <text className="show-plate-year" x={44} y={1128} fontSize={268}>
        {spec.year}
      </text>

      {sparkline(spec)}

      <text className="show-plate-motif" x={62} y={96}>
        {motifLabel(spec.motif)}
      </text>
      <text className="show-plate-no" x={VIEW_W - 62} y={96} textAnchor="end">
        No.{String(spec.plateNo).padStart(3, "0")}
      </text>

      <g stroke="var(--plate-ink)" strokeOpacity={0.32} strokeWidth={1}>
        {[
          [26, 26, 1, 1],
          [VIEW_W - 26, 26, -1, 1],
          [26, VIEW_H - 26, 1, -1],
          [VIEW_W - 26, VIEW_H - 26, -1, -1],
        ].map(([x, y, dx, dy], index) => (
          <g key={index} transform={`translate(${x} ${y})`}>
            <line x1={0} y1={0} x2={dx * 26} y2={0} />
            <line x1={0} y1={0} x2={0} y2={dy * 26} />
          </g>
        ))}
      </g>
    </svg>
  );
}

function motif(spec: PlateSpec): ReactNode {
  if (spec.motif === "aperture") {
    // 和轨道同理：七环时九层方框按 30 递增会让最后一层变成负尺寸。
    // 收到 212 / (层数 - 1) 的间距，最内层始终留得住。
    const step = Math.min(30, 212 / (spec.rings + 1));
    return (
      <>
        {Array.from({ length: spec.rings + 2 }, (_, index) => {
          const size = 236 - index * step;
          return (
            <rect
              key={index}
              x={-size}
              y={-size}
              width={size * 2}
              height={size * 2}
              rx={5}
              fill="none"
              stroke="var(--plate-accent)"
              strokeOpacity={Number(Math.max(0, 0.62 - index * 0.085).toFixed(3))}
              strokeWidth={1.6}
              transform={`rotate(${spec.tilt + index * 11})`}
            />
          );
        })}
        <circle r={9} fill="var(--plate-accent)" fillOpacity={0.85} />
      </>
    );
  }

  if (spec.motif === "orbit") {
    // 七环时 pitch 44 会把最内环推到负半径（252 - 6×44 = -12），
    // SVG 会当作非法属性报错并吞掉那一环；按环数收紧间距，内环始终为正。
    const pitch = Math.min(44, 220 / (spec.rings - 1));
    return (
      <>
        {Array.from({ length: spec.rings }, (_, index) => {
          const radius = 252 - index * pitch;
          return (
            <ellipse
              key={index}
              rx={radius}
              ry={radius * (index % 2 ? 0.42 : 0.74)}
              fill="none"
              stroke="var(--plate-accent)"
              strokeOpacity={Number((0.58 - index * 0.07).toFixed(3))}
              strokeWidth={1.5}
              transform={`rotate(${spec.tilt + index * 9})`}
            />
          );
        })}
        {spec.dots.map((dot, index) => (
          <circle
            key={index}
            cx={Math.cos(dot.angle) * dot.radius}
            cy={Math.sin(dot.angle) * dot.radius}
            r={dot.size}
            fill="var(--plate-accent)"
            fillOpacity={Number((0.75 - index * 0.1).toFixed(3))}
          />
        ))}
        <circle r={8} fill="var(--plate-accent)" fillOpacity={0.85} />
      </>
    );
  }

  if (spec.motif === "burst") {
    return (
      <>
        {Array.from({ length: spec.spokes }, (_, index) => {
          const angle = (index / spec.spokes) * Math.PI * 2;
          const inner = index % 3 === 0 ? 58 : 132;
          const outer = 152 + (index % 4) * 34;
          return (
            <line
              key={index}
              x1={Math.cos(angle) * inner}
              y1={Math.sin(angle) * inner}
              x2={Math.cos(angle) * outer}
              y2={Math.sin(angle) * outer}
              stroke="var(--plate-accent)"
              strokeOpacity={index % 3 === 0 ? 0.62 : 0.34}
              strokeWidth={index % 3 === 0 ? 2 : 1}
            />
          );
        })}
        <circle
          r={62}
          fill="none"
          stroke="var(--plate-accent)"
          strokeOpacity={0.5}
          strokeWidth={1.5}
        />
        <circle r={7} fill="var(--plate-accent)" fillOpacity={0.85} />
      </>
    );
  }

  if (spec.motif === "bars") {
    const width = 46;
    const gap = 26;
    const total = spec.bars.length * width + (spec.bars.length - 1) * gap;
    return (
      <>
        {spec.bars.map((value, index) => {
          const height = 70 + value * 310;
          return (
            <rect
              key={index}
              x={-total / 2 + index * (width + gap)}
              y={-height / 2}
              width={width}
              height={height}
              rx={2}
              fill="var(--plate-accent)"
              fillOpacity={Number((0.16 + value * 0.3).toFixed(3))}
            />
          );
        })}
        <line
          x1={-total / 2 - 18}
          y1={0}
          x2={total / 2 + 18}
          y2={0}
          stroke="var(--plate-accent)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
        />
      </>
    );
  }

  return (
    <>
      {[
        { cx: -96, cy: -54, r: 148 },
        { cx: 86, cy: 26, r: 120 },
        { cx: -18, cy: 156, r: 94 },
      ].map((bubble, index) => (
        <circle
          key={index}
          cx={bubble.cx}
          cy={bubble.cy}
          r={bubble.r}
          fill="none"
          stroke="var(--plate-accent)"
          strokeOpacity={Number((0.52 - index * 0.1).toFixed(3))}
          strokeWidth={1.5}
        />
      ))}
      {spec.dots.slice(0, 3).map((dot, index) => (
        <circle
          key={`dot${index}`}
          cx={-96 + index * 86}
          cy={-54 + index * 96}
          r={dot.size}
          fill="var(--plate-accent)"
          fillOpacity={0.75}
        />
      ))}
    </>
  );
}

function sparkline(spec: PlateSpec): ReactNode {
  const left = 62;
  const right = VIEW_W - 62;
  const baseline = 986;
  const top = 862;
  const step = (right - left) / (spec.points.length - 1);
  const path = spec.points
    .map((value, index) => {
      const x = left + index * step;
      const y = baseline - value * (baseline - top);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${right},${baseline} L${left},${baseline} Z`;

  return (
    <g>
      <line
        x1={left}
        y1={baseline}
        x2={right}
        y2={baseline}
        stroke="var(--plate-ink)"
        strokeOpacity={0.28}
      />
      <path d={area} fill="var(--plate-accent)" fillOpacity={0.09} />
      <path d={path} fill="none" stroke="var(--plate-accent)" strokeOpacity={0.72} strokeWidth={1.8} />
      <circle
        cx={right}
        cy={baseline - spec.points[spec.points.length - 1] * (baseline - top)}
        r={4.5}
        fill="var(--plate-accent)"
      />
    </g>
  );
}
