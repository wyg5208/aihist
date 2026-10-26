import type { ReactNode } from "react";
import type { TimelineItem } from "../types";
import { CATEGORY_META, CATEGORY_ORDER, FAMILY_LABELS, familyLabel, formatCount } from "../lib/format";
import { ERAS, eraFor } from "../lib/eras";
import { CadenceSpark } from "./CadenceSpark";

interface Props {
  items: TimelineItem[];
  activeYear: number | null;
  activeKeyword?: string;
  onKeyword?: (keyword: string) => void;
  children?: ReactNode;
}

const GENERIC_KEYWORDS = new Set(["产业", "研究", "观点", "里程碑", "人工智能"]);

/** The topical index reads best with a stable spine instead of raw frequency. */
const FEATURED_KEYWORDS = [
  "开源",
  "算法",
  "技术",
  "人物",
  "机器人",
  "脑机接口",
  "智能体",
  "推理",
  "多模态",
  "芯片",
  "训练",
  "评测",
  "医疗",
  "具身",
  "监管",
  "国内",
];

export function SideRail({
  items,
  activeYear,
  activeKeyword,
  onKeyword,
  children,
}: Props) {
  const fallbackYear = items[0]?.year ?? new Date().getFullYear();
  const era = eraFor(activeYear ?? fallbackYear);
  const eraIndex = ERAS.findIndex((entry) => entry.from === era.from);
  const upper = eraIndex <= 0 ? new Date().getFullYear() : ERAS[eraIndex - 1].from - 1;

  const counts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();
  const families = new Set<string>();
  for (const item of items) {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
    for (const family of item.sourceFamilies || []) families.add(family);
    for (const tag of item.tags || []) {
      if (GENERIC_KEYWORDS.has(tag)) continue;
      keywordCounts.set(tag, (keywordCounts.get(tag) || 0) + 1);
    }
  }
  const max = Math.max(1, ...counts.values());
  const topKeywords = FEATURED_KEYWORDS.filter((tag) => keywordCounts.has(tag)).map(
    (tag) => [tag, keywordCounts.get(tag) as number] as [string, number]
  );

  return (
    <aside className="space-y-7" aria-label="档案侧栏">
      <section className="rail-card" data-era-kind={era.kind} aria-labelledby="era-heading">
        <div className="rail-heading">
          <h2 id="era-heading">{era.kind === "winter" ? "低谷期" : "时代摘要"}</h2>
          <span className="font-mono text-[9px] tracking-[0.1em] text-[var(--muted)]">
            {era.from}—{upper}
          </span>
        </div>
        <p className="mt-2 font-serif text-lg leading-snug text-[var(--ink)]">{era.title}</p>
        <p className="prose-note mt-1.5">{era.text}</p>
      </section>

      <section className="rail-card" aria-labelledby="distribution-heading">
        <div className="rail-heading">
          <h2 id="distribution-heading">类别分布</h2>
          <span className="font-mono text-[9px] tracking-[0.1em] text-[var(--muted)]">
            {formatCount(items.length)} 条
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {CATEGORY_ORDER.map((key) => {
            const count = counts.get(key) || 0;
            const meta = CATEGORY_META[key];
            return (
              <li key={key} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <span className="w-24 font-mono text-[10px] tracking-[0.05em] text-[var(--ink-soft)]">
                  <span aria-hidden="true" className="mr-1 text-[8px] text-[var(--muted)]">
                    {meta.mark}
                  </span>
                  {meta.label}
                </span>
                <span className="dist-bar" data-category={key}>
                  <span style={{ width: `${Math.round((count / max) * 100)}%` }} />
                </span>
                <span className="w-7 text-right font-mono text-[10px] tabular-nums text-[var(--muted)]">
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {topKeywords.length > 0 && (
        <section className="rail-card" aria-labelledby="keyword-heading">
          <div className="rail-heading">
            <h2 id="keyword-heading">关键词索引</h2>
            <span className="font-mono text-[9px] tracking-[0.1em] text-[var(--muted)]">
              {topKeywords.length} / {formatCount(keywordCounts.size)}
            </span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {topKeywords.map(([tag, count]) => (
              <li key={tag}>
                <button
                  type="button"
                  className="keyword-chip"
                  data-active={activeKeyword === tag}
                  aria-pressed={activeKeyword === tag}
                  onClick={() => onKeyword?.(tag)}
                  aria-label={`按关键词「${tag}」筛选档案，共 ${count} 条`}
                >
                  {tag}
                  <span className="keyword-count">{count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CadenceSpark items={items} />

      {children}

      <section className="rail-card" aria-labelledby="method-heading">
        <div className="rail-heading">
          <h2 id="method-heading">来源与校验</h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Method
          </span>
        </div>
        <p className="prose-note mt-2">
          官方公告、模型目录、论文预印本、社区讨论与媒体报道分别计为独立来源类别。
          两类以上指向同一事件记为「已证实」，单一权威来源记为「高可信」。
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
          {Object.keys(FAMILY_LABELS).map((family) => (
            <li
              key={family}
              className={`font-mono text-[9px] tracking-[0.05em] ${
                families.has(family) ? "text-[var(--ink-soft)]" : "text-[var(--muted)]"
              }`}
            >
              {familyLabel(family)}
              <span className="ml-1 text-[var(--muted)]">
                {families.has(family) ? "·" : "—"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">
          不授予删除权限；条目通过指纹去重，重跑同步不会重复入档。
        </p>
      </section>
    </aside>
  );
}
