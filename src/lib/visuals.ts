import manifest from "../data/visuals.json";
import type { TimelineItem } from "../types";

/**
 * 真实配图。
 *
 * 每一张进放映的图都必须说清楚是谁的、按什么条件能用：`credit` 是署名，
 * `license` 是授权（公有领域 / CC BY 4.0 / 官方新闻稿 / 本机截图……），
 * `sourceUrl` 是核对出处。缺任何一项就不要登记——编年史站点的图片一旦
 * 说不清来历，比没有图更伤可信度。没有登记的条目走 `VisualPlate`。
 */
export type VisualKind = "photo" | "screenshot" | "illustration";

export interface VisualEntry {
  src: string;
  alt: string;
  credit: string;
  license: string;
  kind: VisualKind;
  sourceUrl?: string;
  /** CSS object-position, for crops that would otherwise cut a face off. */
  cover?: string;
}

interface Manifest {
  note?: string;
  items: Record<string, VisualEntry>;
}

const ITEMS: Record<string, VisualEntry> = (manifest as Manifest).items ?? {};

export function visualFor(item: Pick<TimelineItem, "id" | "slug">): VisualEntry | null {
  return ITEMS[item.slug || item.id] ?? null;
}

export function visualCredit(entry: VisualEntry): string {
  return `${entry.credit} · ${entry.license}`;
}
