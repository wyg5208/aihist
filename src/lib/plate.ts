import type { Category, TimelineItem } from "../types";

/**
 * 编年图版（plate）的参数。
 *
 * 档案里 158 条以上记录绝大多数没有、也不会有可授权的实拍配图，所以每一屏
 * 的视觉由条目自身推导出来：同一个 slug 永远得到同一张图版，换设备、换主题、
 * 断网都一致。图案只做几何与排版，不描摹历史场景——它不是照片，也不假装是。
 * 真图从 `visuals.json` 进来时优先使用，图版退为兜底。
 */
export type PlateMotif = "aperture" | "orbit" | "burst" | "bars" | "bubbles";

export interface OrbitDot {
  angle: number;
  radius: number;
  size: number;
}

export interface PlateSpec {
  year: string;
  plateNo: number;
  motif: PlateMotif;
  tilt: number;
  rings: number;
  spokes: number;
  points: number[];
  bars: number[];
  dots: OrbitDot[];
}

const MOTIFS: Record<Category, PlateMotif> = {
  model: "aperture",
  research: "orbit",
  milestone: "burst",
  policy: "bars",
  opinion: "bubbles",
};

/** FNV-1a: short, stable, and no dependency. */
function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** xorshift32, so a single seed yields a whole readable sequence. */
function sequence(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function plateSpec(item: TimelineItem): PlateSpec {
  const seed = hash(
    [item.slug || item.id, item.year, item.category, (item.tags || []).join(",")].join("|")
  );
  const next = sequence(seed);
  const between = (low: number, high: number) => low + next() * (high - low);

  return {
    year: String(item.year).padStart(4, "0"),
    plateNo: (seed % 997) + 1,
    motif: MOTIFS[item.category] ?? "burst",
    tilt: Math.round(between(-10, 10)),
    rings: 4 + Math.round(next() * 3),
    spokes: 24 + Math.round(next() * 3) * 4,
    points: Array.from({ length: 16 }, () => Number(between(0.12, 1).toFixed(3))),
    bars: Array.from({ length: 9 }, () => Number(between(0.18, 1).toFixed(3))),
    dots: Array.from({ length: 5 }, () => ({
      angle: between(0, Math.PI * 2),
      radius: between(70, 250),
      size: between(3, 8),
    })),
  };
}

export function motifLabel(motif: PlateMotif): string {
  if (motif === "aperture") return "光阑";
  if (motif === "orbit") return "轨道";
  if (motif === "burst") return "放射";
  if (motif === "bars") return "柱列";
  return "叠圆";
}
