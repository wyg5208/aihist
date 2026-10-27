import type { ReactNode } from "react";
import type { Confidence, TimelineItem } from "../types";
import { BrandMark } from "../components/BrandMark";
import { EventDetail } from "../components/EventDetail";
import { SubscribeForm } from "../components/SubscribeForm";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useEventDetail } from "../hooks/useEventDetail";
import type { ArchiveController } from "../hooks/useArchive";
import { quarterSlots, type CadenceSlot } from "../lib/cadence";
import { eraFor } from "../lib/eras";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  CONFIDENCE_META,
  formatCount,
  relativeTime,
  shortDate,
} from "../lib/format";

const wrap = "mx-auto w-full max-w-[1400px] px-4 sm:px-[30px]";

const CONFIDENCE_TONE: Record<Confidence, string> = {
  verified: "bg-[rgba(95,240,180,.12)] text-[#5ff0b4]",
  likely: "bg-[rgba(255,196,107,.12)] text-[#ffc46b]",
  single: "bg-[rgba(255,255,255,.07)] text-[var(--muted)]",
};

/**
 * 03 · 深色极光.
 *
 * The night console: no strip, a 70px glass header with a live pulse, a bento
 * of four figures with two sparklines, and the filter strip living *inside*
 * the hero instead of sticking to the top. Rows are three columns — date,
 * title, and a right rail that carries the evidence count and the way in.
 */
export function AuroraView({ archive }: { archive: ArchiveController }) {
  const {
    phase,
    error,
    items,
    total,
    truncated,
    refreshing,
    reload,
    filtered,
    groups,
    query,
    category,
    setQuery,
    setCategory,
    clearFilters,
    clearExtras,
    focusKeyword,
    hasHiddenFilters,
    categoryCounts,
    expandedId,
    toggleRow,
    missingSlug,
    dismissMissingSlug,
    lastSuccessAt,
    running,
    modelCount,
    evidenceCount,
    panelSeats,
    openStandard,
  } = archive;

  const showLoading = phase === "loading";
  const showError = phase === "error";
  const hasArchive = items.length > 0;
  const slots = quarterSlots(items);
  const newest = items[0];
  const newestShare = newest
    ? items.filter((item) => item.year === newest.year).length
    : 0;

  return (
    <div className="min-h-dvh">
      <header className="au-nav">
        <div className={`${wrap} flex h-[70px] items-center gap-7`}>
          <a href="/" className="flex items-center gap-2.5 whitespace-nowrap">
            <BrandMark variant="glow" size={28} />
            <span className="text-[18px] font-bold tracking-[-0.01em] text-[var(--ink)]">
              AI 纪年
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)] sm:inline">
              Chronicle
            </span>
          </a>

          <nav aria-label="主导航" className="hidden items-center gap-6.5 text-[14px] text-[var(--ink-soft)] lg:flex">
            <a href="#timeline" className="relative font-medium text-[var(--ink)] after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded after:bg-[linear-gradient(90deg,#54e3ff,#a98bff)]">
              时间轴
            </a>
            <button type="button" onClick={openStandard} className="transition-colors hover:text-white">
              收录标准
            </button>
            <a href="/api/v1/correct" className="transition-colors hover:text-white">
              发现错误
            </a>
            <a href="/admin/" className="transition-colors hover:text-white">
              管理台
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            <span className="mr-1 hidden items-center gap-1.5 text-[12.5px] text-[var(--muted)] lg:inline-flex">
              <i
                className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]"
                style={{ boxShadow: "0 0 0 4px color-mix(in srgb, var(--ok) 14%, transparent)" }}
                aria-hidden="true"
              />
              {running ? "正在同步" : lastSuccessAt ? `${relativeTime(lastSuccessAt)}同步` : "待建立"}
            </span>
            <ThemeSwitcher />
            <a
              className="au-line hidden h-9 items-center px-4 text-[13px] font-semibold transition-colors sm:inline-flex"
              href="/api/v1/open/apply"
            >
              API 申请
            </a>
            <a
              className="au-glow inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-[filter,transform]"
              href="/api/v1/subscribe?src=nav"
            >
              订阅更新
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="pb-10">
        <section className="pt-16">
          <div className={wrap}>
            <div className="grid gap-9 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-11">
              <div>
                <span className="inline-flex items-center gap-2.5 rounded-full border border-[var(--rule)] bg-[rgba(255,255,255,.03)] py-1.5 pl-2 pr-3.5 text-[12.5px] text-[var(--ink-soft)]">
                  <b className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(84,227,255,.14)] px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.1em] text-[#54e3ff]">
                    LIVE
                  </b>
                  1912 — {new Date().getFullYear()} · {formatCount(total)} 条记录 · {archive.familyCount} 个来源
                </span>

                <h1 className="au-title mt-5 text-[clamp(40px,5.4vw,72px)] font-extrabold leading-[1.02] tracking-[-0.04em] text-[var(--ink)]">
                  一条时间轴，
                  <br />
                  <span>看清 AI 的每一步。</span>
                </h1>

                <p className="mt-4.5 max-w-[54ch] text-[16.5px] leading-[1.75] text-[var(--ink-soft)]">
                  模型发布、关键论文与政策变化，按年份编排。每条记录附来源、证据与置信度；
                  自动条目经五家厂商各一席模型评审，票型与分歧全部公开。
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <a className="au-glow inline-flex h-11 items-center rounded-full px-6 text-[14.5px] font-semibold transition-[filter,transform]" href="#timeline">
                    进入时间轴
                  </a>
                  <a className="au-line inline-flex h-11 items-center rounded-full px-6 text-[14.5px] font-semibold transition-colors" href="/api/v1/open/apply">
                    申请 API Key
                  </a>
                </div>

                <div className="mt-4.5 flex flex-wrap gap-x-5.5 gap-y-2 text-[12.8px] text-[var(--muted)]">
                  <span>
                    <b className="font-semibold text-[var(--ink)]">{formatCount(evidenceCount)}</b> 条引用链接
                  </span>
                  <span>
                    <b className="font-semibold text-[var(--ink)]">{formatCount(modelCount)}</b> 条模型发布
                  </span>
                  <span>
                    每日 <b className="font-semibold text-[var(--ink)]">01:05</b> 自动采集
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3" aria-label="档案速览">
                <div className="au-cell p-4">
                  <p className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">
                    {formatCount(total)}
                    <small className="ml-1 text-[12px] font-semibold text-[var(--muted)]">条</small>
                  </p>
                  <p className="mt-1.5 text-[12.2px] text-[var(--muted)]">已入档事件</p>
                  <Spark slots={slots} />
                </div>

                <div className="au-cell p-4">
                  <p className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">
                    {newest ? newest.year : "—"}
                    <small className="ml-1 text-[12px] font-semibold text-[var(--muted)]">年</small>
                  </p>
                  <p className="mt-1.5 text-[12.2px] text-[var(--muted)]">
                    当前收录年份 · {newestShare} 条
                  </p>
                  <Spark slots={slots} />
                </div>

                <div className="au-cell p-4">
                  <p className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">
                    {archive.familyCount}
                    <small className="ml-1 text-[12px] font-semibold text-[var(--muted)]">个</small>
                  </p>
                  <p className="mt-1.5 text-[12.2px] text-[var(--muted)]">来源类别 · {formatCount(evidenceCount)} 条引用</p>
                </div>

                <div className="au-cell p-4">
                  <p className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">
                    {panelSeats || "—"}
                    <small className="ml-1 text-[12px] font-semibold text-[var(--muted)]">席</small>
                  </p>
                  <p className="mt-1.5 text-[12.2px] text-[var(--muted)]">模型评审 · 三票通过</p>
                </div>

                <div className="au-cell au-cell-wide col-span-2 flex items-center justify-between gap-4 p-4">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[var(--ink)]">订阅每周简报</h2>
                    <p className="mt-1 text-[12.5px] text-[var(--ink-soft)]">
                      只讲这一周新增了什么，附原链。
                    </p>
                  </div>
                  <a className="au-line inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold" href="/api/v1/subscribe?src=hero">
                    订阅
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-2.5 rounded-2xl border border-[var(--rule)] bg-[var(--surface)] p-3">
              <span className="px-2 font-mono text-[11.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                筛选
              </span>
              <Chip
                pressed={category === "all"}
                onClick={() => setCategory("all")}
                label="全部"
                count={categoryCounts.all ?? total}
              />
              {CATEGORY_ORDER.map((key) => (
                <Chip
                  key={key}
                  pressed={category === key}
                  onClick={() => setCategory(category === key ? "all" : key)}
                  label={CATEGORY_META[key].short}
                  count={categoryCounts[key] ?? 0}
                />
              ))}
              {hasHiddenFilters && (
                <button
                  type="button"
                  onClick={clearExtras}
                  className="h-8 rounded-full border border-transparent px-2 text-[12px] text-[#54e3ff] underline underline-offset-4"
                >
                  清除其他筛选
                </button>
              )}
              <label className="ml-auto flex h-[34px] min-w-[230px] items-center gap-2 rounded-full border border-[var(--rule)] bg-[rgba(0,0,0,.25)] px-3">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="shrink-0 text-[var(--muted)]"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索事件、机构或模型"
                  aria-label="检索档案"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                />
              </label>
            </div>
          </div>
        </section>

        <div id="timeline" className={`${wrap} scroll-mt-24`}>
          {missingSlug && (
            <div role="status" className="mt-5 border-l-2 border-[#54e3ff] pl-3">
              <p className="text-[13.5px] leading-6 text-[var(--ink-soft)]">
                地址中的条目「{missingSlug}」没有找到，可能已被合并，或尚未同步到本页。
              </p>
              <button
                type="button"
                onClick={dismissMissingSlug}
                className="mt-1 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[#54e3ff] underline underline-offset-4"
              >
                回到时间轴
              </button>
            </div>
          )}

          {truncated && (
            <p className="mt-5 border-l-2 border-[#54e3ff] pl-3 text-[12.5px] leading-6 text-[var(--ink-soft)]">
              档案较大，当前只载入最近 1200 条；更早的条目仍保存在数据库中。
            </p>
          )}

          {showLoading && <LoadingState />}
          {showError && <ErrorState code={error} onRetry={() => void reload()} />}
          {!showLoading && !showError && !hasArchive && (
            <div className="mt-8">
              <EmptyState reason="archive" />
            </div>
          )}
          {!showLoading && !showError && hasArchive && filtered.length === 0 && (
            <div className="mt-8">
              <EmptyState reason="filter" onClear={clearFilters} />
            </div>
          )}

          {!showLoading && filtered.length > 0 && (
            <div className={refreshing ? "opacity-70" : undefined}>
              {groups.map((group) => (
                <YearBlock
                  key={group.year}
                  year={group.year}
                  items={group.items}
                  expandedId={expandedId}
                  onToggle={toggleRow}
                  onKeyword={focusKeyword}
                />
              ))}

              <div className="au-cta mt-10 grid items-center gap-6 px-8 py-8 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <h2 className="text-[25px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    订阅，或直接把档案接进你的产品
                  </h2>
                  <p className="mt-2 max-w-[56ch] text-[13.8px] leading-6 text-[var(--ink-soft)]">
                    每周一封邮件只写新增记录；开放 API 返回结构化事件、证据与原链，
                    免费额度每秒 5 次，通常 1 个工作日内开通。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <a className="au-glow inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold transition-[filter,transform]" href="/api/v1/subscribe?src=cta">
                    订阅更新
                  </a>
                  <a className="au-line inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold transition-colors" href="/api/v1/open/apply">
                    申请 API
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="au-foot mt-13">
        <div className={`${wrap} pb-6 pt-11`}>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.3fr]">
            <div>
              <a href="/" className="flex items-center gap-2.5 whitespace-nowrap">
                <BrandMark variant="glow" size={28} />
                <span className="text-[18px] font-bold text-[var(--ink)]">AI 纪年</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                  Chronicle
                </span>
              </a>
              <p className="mt-3.5 max-w-[38ch] text-[13px] leading-[1.8] text-[var(--muted)]">
                从 1912 年的象棋自动机到 2026 年的前沿模型。条目来自公开接口与官方公告，
                经去重与交叉验证入档。
              </p>
            </div>

            <FootColumn title="浏览">
              <a href="#timeline" className="hover:text-[#54e3ff]">
                时间轴
              </a>
              <button type="button" onClick={openStandard} className="text-left hover:text-[#54e3ff]">
                收录标准
              </button>
              <a href="/api/v1/timeline?limit=1200" className="hover:text-[#54e3ff]">
                数据下载
              </a>
              <a href="/admin/" className="hover:text-[#54e3ff]">
                管理台
              </a>
            </FootColumn>

            <FootColumn title="开放">
              <a href="/api/v1/open/apply" className="hover:text-[#54e3ff]">
                API 申请
              </a>
              <a href="/api/v1/subscribe?src=footer" className="hover:text-[#54e3ff]">
                订阅更新
              </a>
              <a href="/api/v1/correct" className="hover:text-[#54e3ff]">
                发现错误
              </a>
            </FootColumn>

            <FootColumn title="每周简报">
              <div className="w-full">
                <SubscribeForm
                  source="footer"
                  inputClass="h-10 min-w-0 flex-1 rounded-[10px] border border-[var(--rule-strong)] bg-[rgba(0,0,0,.3)] px-3 text-[13.5px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                  buttonClass="au-glow ml-2 inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold"
                  noteClass="text-[11.5px] leading-5 text-[var(--muted)]"
                />
              </div>
              <p className="text-[11.5px] text-[var(--muted)]">随时退订 · 只写新增</p>
            </FootColumn>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-5.5 gap-y-2.5 border-t border-[var(--rule)] pt-4 text-[12px] text-[var(--muted)]">
            <span>© {new Date().getFullYear()} AI 纪年 · Vol. I</span>
            <span className="flex flex-wrap gap-4.5">
              <a href="/api/v1/subscribe?src=footer" className="hover:text-white">
                订阅更新
              </a>
              <a href="/api/v1/open/apply" className="hover:text-white">
                API 申请
              </a>
              <a href="/api/v1/correct" className="hover:text-white">
                发现错误
              </a>
            </span>
            <span className="ml-auto">数据来自公开接口 · 观点与事实以原链为准</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Spark({ slots }: { slots: CadenceSlot[] }) {
  const max = Math.max(1, ...slots.map((slot) => slot.count));
  return (
    <div className="mt-2.5 flex h-[34px] items-end gap-[3px]" aria-hidden="true">
      {slots.map((slot) => (
        <i
          key={slot.key}
          className="flex-1 rounded-t-[2px]"
          style={{
            height: `${Math.max(8, (slot.count / max) * 100)}%`,
            background: slot.current
              ? "linear-gradient(to top, rgba(84,227,255,.25), rgba(84,227,255,.95))"
              : "linear-gradient(to top, rgba(169,139,255,.2), rgba(169,139,255,.7))",
          }}
        />
      ))}
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  label,
  count,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12.8px] transition-colors ${
        pressed
          ? "border-[rgba(84,227,255,.48)] bg-[rgba(84,227,255,.14)] text-[#54e3ff]"
          : "border-[var(--rule)] text-[var(--ink-soft)] hover:border-[var(--rule-strong)] hover:text-white"
      }`}
    >
      {label}
      <span className="text-[11px] opacity-65">{formatCount(count)}</span>
    </button>
  );
}

function YearBlock({
  year,
  items,
  expandedId,
  onToggle,
  onKeyword,
}: {
  year: number;
  items: TimelineItem[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onKeyword: (tag: string) => void;
}) {
  const era = eraFor(year);

  return (
    <section
      id={`year-${year}`}
      data-year={year}
      className="mt-8 scroll-mt-24"
      aria-labelledby={`year-heading-${year}`}
    >
      <div className="flex items-baseline gap-3.5 border-b border-[var(--rule-strong)] pb-2.5">
        <h2
          id={`year-heading-${year}`}
          className="text-[26px] font-extrabold tracking-[-0.03em] text-[var(--ink)]"
        >
          {year}
        </h2>
        <span className="truncate text-[12px] uppercase tracking-[0.14em] text-[#54e3ff]">
          {era.kind === "winter" ? `低谷 · ${era.title}` : era.title}
        </span>
        <span className="ml-auto shrink-0 text-[12px] text-[var(--muted)]">{items.length} 条</span>
      </div>

      {items.map((item) => (
        <Entry
          key={item.id}
          item={item}
          expanded={expandedId === item.id}
          onToggle={onToggle}
          onKeyword={onKeyword}
        />
      ))}
    </section>
  );
}

function Entry({
  item,
  expanded,
  onToggle,
  onKeyword,
}: {
  item: TimelineItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onKeyword: (tag: string) => void;
}) {
  const { detail, loading, error, retry } = useEventDetail(item.id, expanded);
  const meta = CATEGORY_META[item.category] || CATEGORY_META.milestone;
  const tone = CONFIDENCE_TONE[item.confidence] || CONFIDENCE_TONE.single;
  const detailId = `entry-detail-${item.id}`;

  return (
    <article id={`entry-${item.slug || item.id}`} className="au-entry">
      <div className="grid gap-4.5 px-4 py-4.5 md:grid-cols-[88px_minmax(0,1fr)_auto]">
        <div className="pt-0.5 text-[12px] tabular-nums text-[var(--muted)]">
          <b className="block text-[17px] font-bold text-[var(--ink)]">
            {shortDate(item.eventDate, item.datePrecision)}
          </b>
          {item.datePrecision !== "year" && (
            <span className="text-[11.5px]">{item.eventDate.slice(0, 4)}</span>
          )}
          <span className="mt-2 inline-block rounded-[5px] border border-[var(--rule-strong)] px-1.5 py-0.5 text-[10.5px] tracking-[0.08em] text-[var(--ink-soft)]">
            {meta.short}
          </span>
        </div>

        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-[1.45] tracking-[-0.01em] text-[var(--ink)]">
            <button
              type="button"
              onClick={() => onToggle(item.id)}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="text-left transition-colors hover:text-[#54e3ff]"
            >
              {item.title}
            </button>
            {item.titleEn && item.titleEn !== item.title && (
              <span className="ml-1.5 text-[12.5px] font-normal text-[var(--muted)]">
                {item.titleEn}
              </span>
            )}
          </h3>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[var(--muted)]">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
            >
              {CONFIDENCE_META[item.confidence]?.label ?? "—"}
            </span>
            {item.organization && (
              <>
                <span className="h-2.5 w-px bg-[var(--rule-strong)]" aria-hidden="true" />
                <span>{item.organization}</span>
              </>
            )}
            <span className="h-2.5 w-px bg-[var(--rule-strong)]" aria-hidden="true" />
            <span>来源 {item.sourceCount} 家</span>
            {item.tags.slice(0, 2).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onKeyword(tag)}
                className="text-[#9fc6ff] transition-colors hover:text-[#54e3ff]"
                aria-label={`按关键词「${tag}」筛选档案`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 md:flex-col md:items-end md:justify-start md:gap-1.5">
          <span className="whitespace-nowrap text-[11.5px] text-[var(--muted)]">
            重要度 {item.importance}
          </span>
          <button
            type="button"
            onClick={() => onToggle(item.id)}
            aria-expanded={expanded}
            aria-controls={detailId}
            className="whitespace-nowrap text-[12.5px] font-semibold text-[#54e3ff]"
          >
            {expanded ? "收起证据 ↑" : "展开证据 →"}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={detailId} className="px-4 pb-5 pt-1 md:pl-[106px]">
          <EventDetail
            detail={detail}
            loading={loading}
            error={error}
            onRetry={retry}
            onKeyword={onKeyword}
          />
        </div>
      )}
    </article>
  );
}

function FootColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
        {title}
      </h4>
      <div className="mt-3 flex flex-col items-start gap-2.5 text-[13.5px] text-[var(--ink-soft)]">
        {children}
      </div>
    </div>
  );
}
