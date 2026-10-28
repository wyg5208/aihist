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
  /**
   * `contain` 留给“宁可留白也不能裁”的横构图：整幅缩进画框，上下留出的
   * 是主题的 --plate-bg，所以不用把纸色烤进 JPEG。默认铺满（cover）。
   */
  fit?: "cover" | "contain";
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

/**
 * 画框占视口宽的比例：`.show-slide` 是 0.94fr / 1.06fr，900 断点以下改单列。
 * `<img sizes>` 与下面的预取都从这一处取值，两边不能各写一个数。
 */
export const SHOW_IMAGE_SIZES = "(max-width: 900px) 100vw, 47vw";

export interface VisualSources {
  /** 760w，覆盖 DPR1 桌面与窄屏。 */
  narrow: string;
  /** 900w，覆盖 DPR2 桌面与 DPR3 手机。 */
  wide: string;
}

/**
 * 同一张图的 WebP 两档，由 `scripts/build-visuals.mjs` 生成。
 * 源不是 JPEG（或将来换成别的格式）时返回 null，调用方直接走原图。
 */
export function visualSources(entry: VisualEntry): VisualSources | null {
  if (!entry.src.endsWith(".jpg")) return null;
  const stem = entry.src.slice(0, -4);
  return { narrow: `${stem}-760.webp`, wide: `${stem}.webp` };
}

/** 画框此刻需要多少 CSS 像素宽。 */
function frameWidth(): number {
  const viewport = window.innerWidth || 1440;
  return viewport <= 900 ? viewport : Math.round(viewport * 0.47);
}

/**
 * 按当前视口与像素比挑一档。挑窄了浏览器会自己回退到 srcset 的下一档，
 * 这里只是让预取猜得准一些，不必精确。
 */
export function visualSrcForViewport(entry: VisualEntry): string {
  const sources = visualSources(entry);
  if (!sources) return entry.src;
  const needed = frameWidth() * (window.devicePixelRatio || 1);
  return needed > 760 ? sources.wide : sources.narrow;
}

const PREFETCHED = new Set<string>();

/**
 * 预取放映里还没出现的图。
 *
 * 只预热浏览器 HTTP 缓存，不碰 DOM、不触发渲染；等到那一屏真的挂上
 * `<img>` 时命中的是本地缓存，翻页就不会先空一块再出图。
 */
export function prefetchVisuals(
  items: Array<Pick<TimelineItem, "id" | "slug"> | null | undefined>
): void {
  for (const item of items) {
    if (!item) continue;
    const entry = visualFor(item);
    if (!entry) continue;
    const url = visualSrcForViewport(entry);
    if (PREFETCHED.has(url)) continue;
    PREFETCHED.add(url);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }
}
