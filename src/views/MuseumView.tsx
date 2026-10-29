import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Category, Confidence, TimelineItem } from "../types";
import { BrandMark } from "../components/BrandMark";
import { EraBrief, EraNote } from "../components/EraBrief";
import { EventDetail } from "../components/EventDetail";
import { FooterSites } from "../components/FooterSites";
import { SubscribeForm } from "../components/SubscribeForm";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useEventDetail } from "../hooks/useEventDetail";
import type { ArchiveController } from "../hooks/useArchive";
import { eraFor } from "../lib/eras";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  CONFIDENCE_META,
  familyLabel,
  formatCount,
  relativeTime,
  shortDate,
} from "../lib/format";

const wrap = "mx-auto w-full max-w-[1440px] px-4 sm:px-[30px]";

/** Vitrine labels: one tint per category, exactly as the plate reads. */
const CATEGORY_TONE: Record<Category, string> = {
  milestone: "bg-[#e9e3d1] text-[#42564a]",
  model: "bg-[#e2ece4] text-[#1c5340]",
  research: "bg-[#e9e3d1] text-[#42564a]",
  opinion: "bg-[#e9e3d1] text-[#42564a]",
  policy: "bg-[#ece6d5] text-[#7a5f27]",
};

const CONFIDENCE_TONE: Record<Confidence, string> = {
  verified: "text-[var(--ok)]",
  likely: "text-[#8a6516]",
  single: "text-[var(--muted)]",
};

/**
 * 05 · 博物馆暖调.
 *
 * Linen and glass: a green notice bar names the vitals, a three-column header
 * centres the seal-stamped brand, and the opening pairs the statement with a
 * "本月新增" vitrine that ends in the subscribe block. Below the three promises
 * the year scrubber sticks (74px header) above a two-column card grid — the
 * only view where an entry is a card rather than a row.
 */
export function MuseumView({ archive }: { archive: ArchiveController }) {
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
    years,
    activeYear,
    jumpTo,
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
    notice,
    modelCount,
    familyCount,
    evidenceCount,
    panelSeats,
    recent,
    recentMonth,
    openStandard,
  } = archive;

  const showLoading = phase === "loading";
  const showError = phase === "error";
  const hasArchive = items.length > 0;

  return (
    <div className="min-h-dvh">
      <div className="mu-notice text-[11.5px] tracking-[0.1em]">
        <div className={`${wrap} flex h-8 items-center justify-between gap-4`}>
          <span className="truncate">
            <b className="font-semibold text-[#f2e8d0]">1912—{new Date().getFullYear()}</b>
            {" · "}
            {formatCount(total)} 条记录 · 每日 01:05 自动采集 · 最近同步
            {lastSuccessAt ? ` ${relativeTime(lastSuccessAt)}` : " 待建立"}
          </span>
          <span className="hidden shrink-0 gap-[18px] sm:flex">
            <button type="button" onClick={openStandard} className="hover:text-white">
              收录标准
            </button>
            <a href="#method" className="hover:text-white">
              数据来源
            </a>
            <a href="/admin/" className="hover:text-white">
              管理台
            </a>
          </span>
        </div>
      </div>

      <header className="mu-nav">
        <div className={`${wrap} grid h-[74px] grid-cols-[1fr_auto] items-center gap-5 lg:grid-cols-[1fr_auto_1fr]`}>
          <nav
            aria-label="主导航"
            className="hidden items-center gap-5.5 text-[13.8px] text-[var(--ink-soft)] lg:flex"
          >
            <a href="#timeline" className="font-semibold text-[var(--ink)]">
              时间轴
            </a>
            <button type="button" onClick={openStandard} className="transition-colors hover:text-[var(--ink)]">
              收录标准
            </button>
            <a href="/api/v1/correct" className="transition-colors hover:text-[var(--ink)]">
              发现错误
            </a>
            <a href="/admin/" className="transition-colors hover:text-[var(--ink)]">
              管理台
            </a>
          </nav>

          <a href="/" className="flex items-center gap-2 whitespace-nowrap justify-self-start sm:gap-2.75 lg:justify-self-center">
            <BrandMark variant="seal" size={30} />
            <span className="font-serif text-[22px] tracking-[0.02em] text-[var(--ink)] sm:text-[23px]">AI 纪年</span>
            <em className="hidden font-sans text-[10px] not-italic uppercase tracking-[0.24em] text-[var(--muted)] sm:inline">
              Chronicle
            </em>
          </a>

          <div className="flex items-center justify-end gap-2.5 text-[13.8px] text-[var(--ink-soft)] sm:gap-4">
            <ThemeSwitcher />
            <a href="/api/v1/open/apply" className="hidden transition-colors hover:text-[var(--ink)] sm:inline">
              API 申请
            </a>
            <a
              href="/api/v1/subscribe?src=nav"
              className="mu-green inline-flex h-9 items-center rounded-[5px] px-3.5 text-[13px] font-semibold transition-colors"
            >
              订阅更新
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="pb-[30px] pt-[46px]">
          <div className={wrap}>
            <div className="grid items-start gap-[26px] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-11">
              <div>
                <p className="flex items-center gap-2.5 font-mono text-[11.5px] font-bold uppercase tracking-[0.18em] text-[var(--accent-mark)]">
                  人工智能发展编年史 · Vol. I
                  <span className="h-px max-w-[120px] flex-1 bg-[var(--rule-strong)]" aria-hidden="true" />
                </p>

                <h1 className="mt-3.5 font-serif text-[clamp(34px,5.6vw,76px)] leading-[1.04] tracking-[-0.02em] text-[var(--ink)]">
                  七十余年机器智能，
                  <br />
                  <span className="text-[var(--deep)]">按年份收进一份档案。</span>
                </h1>

                <p className="mt-4 max-w-[54ch] text-[16.4px] leading-[1.78] text-[var(--ink-soft)]">
                  从 1912 年的象棋自动机到 {new Date().getFullYear()} 年的前沿模型，记录关键事件、模型发布与重要研究。每条记录附
                  <b className="font-semibold text-[var(--ink)]">来源、证据与置信度</b>
                  ，自动条目还要经五家厂商各一席模型评审，至少三票同意才入档。
                </p>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  <a
                    href="#timeline"
                    className="mu-green inline-flex h-11 items-center rounded-[6px] px-5.5 text-[14.5px] font-semibold transition-colors"
                  >
                    浏览时间轴
                  </a>
                  <a
                    href="/api/v1/open/apply"
                    className="inline-flex h-11 items-center rounded-[6px] border border-[var(--rule-strong)] px-5.5 text-[14.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--deep)] hover:bg-white"
                  >
                    申请 API Key
                  </a>
                </div>

                <div className="mt-[18px] flex flex-wrap gap-x-5.5 gap-y-2 text-[12.8px] text-[var(--muted)]">
                  <span>
                    <b className="font-semibold text-[var(--ink)]">{formatCount(total)}</b> 条档案
                  </span>
                  <span>
                    <b className="font-semibold text-[var(--ink)]">{familyCount}</b> 个来源站点
                  </span>
                  <span>
                    <b className="font-semibold text-[var(--ink)]">{formatCount(evidenceCount)}</b> 条引用链接
                  </span>
                  <span>
                    <b className="font-semibold text-[var(--ink)]">{formatCount(modelCount)}</b> 条模型发布
                  </span>
                </div>
              </div>

              <aside
                className="overflow-hidden rounded-[10px] border border-[var(--rule)] bg-[var(--surface)] shadow-[0_20px_40px_-36px_rgba(19,36,29,0.7)]"
                aria-label="本月新增"
              >
                <div className="flex items-baseline justify-between gap-2.5 border-b border-[var(--rule)] bg-[#fffdf7] px-[18px] py-[15px]">
                  <h2 className="font-serif text-[17px] text-[var(--ink)]">本月新增</h2>
                  <span className="text-[12px] text-[var(--muted)]">
                    {recent.length} 条 · {recentMonth || `${new Date().getFullYear()} 年`}
                  </span>
                </div>

                <div className="px-[18px] pb-2 pt-1">
                  {recent.length === 0 && (
                    <p className="py-4 text-[12.8px] text-[var(--muted)]">本月的采集尚未开始。</p>
                  )}
                  {recent.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        toggleRow(item.id);
                        jumpTo(item.year);
                      }}
                      className="grid w-full grid-cols-[44px_minmax(0,1fr)] gap-2.5 border-b border-dashed border-[var(--rule)] py-[11px] text-left last:border-b-0"
                    >
                      <span className="pt-0.5 text-[11.5px] tabular-nums text-[var(--muted)]">
                        {shortDate(item.eventDate, item.datePrecision)}
                      </span>
                      <span className="text-[13.4px] leading-[1.5] text-[var(--ink)]">
                        {item.title}
                        <em className="mt-[3px] block text-[11.5px] not-italic text-[var(--muted)]">
                          {CATEGORY_META[item.category]?.short ?? "记录"} ·{" "}
                          {CONFIDENCE_META[item.confidence]?.label ?? "—"}
                        </em>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mu-green px-[18px] pb-4 pt-3.5">
                  <p className="mb-2.5 text-[12.8px] text-[#c8bb9c]">
                    每周一发一封，只写这一周新增了什么；这一周没有新增就不发。
                  </p>
                  <SubscribeForm
                    source="month"
                    inputClass="h-[38px] min-w-0 flex-1 rounded-[4px] border border-[#35604f] bg-[#0e2c22] px-2.5 text-[13px] text-[#f0e8d4] outline-none placeholder:text-[#8b9c92]"
                    buttonClass="ml-1.5 inline-flex h-[38px] shrink-0 items-center rounded-[4px] bg-[var(--accent-mark)] px-3.5 text-[12.5px] font-semibold text-[#20180a] hover:bg-[#c29c58]"
                    noteClass="mt-1.5 text-[11px] leading-5 text-[#c8bb9c]"
                  />
                </div>
              </aside>
            </div>

            <div className="mu-promises mt-[34px]">
              <Promise mark="源" title="来源可查">
                每条记录保留原始链接与证据条数，观点与事实以原链为准。
              </Promise>
              <Promise mark="评" title="五席评审">
                五家厂商各一席模型打分，三票同意且中位分 ≥ 75 才收录。
              </Promise>
              <Promise mark="溯" title="全程可追溯">
                票型分歧、修订记录与纠错队列全部公开，可回到任意一次改动。
              </Promise>
            </div>
          </div>
        </section>

        <div className="mu-scrub">
          <div className={`${wrap} flex items-center gap-3.5 overflow-x-auto py-2.5`}>
            <span className="flex-none font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
              跳到
            </span>
            {years.map((entry, index) => (
              <Fragment key={entry.year}>
                {index === 8 && <span className="h-4 w-px flex-none bg-[var(--rule-strong)]" aria-hidden="true" />}
                <button
                  type="button"
                  data-active={activeYear === entry.year ? "true" : "false"}
                  onClick={() => jumpTo(entry.year)}
                  title={`${entry.year} · ${entry.count} 条`}
                  className="flex-none rounded-[4px] px-2.5 py-1 text-[13px] tabular-nums text-[var(--ink-soft)] transition-colors hover:bg-[#eae3d2] hover:text-[var(--ink)]"
                >
                  {entry.year}
                </button>
              </Fragment>
            ))}
          </div>
        </div>

        <div id="timeline" className={`${wrap} scroll-mt-[7.5rem]`}>
          <div className="mt-[22px] flex flex-wrap items-center gap-2.5">
            <label className="flex h-[42px] min-w-[220px] flex-1 items-center gap-2 rounded-[6px] border border-[var(--rule-strong)] bg-[#fffdf7] px-3">
              <svg
                width="15"
                height="15"
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
                placeholder="搜索事件、机构、模型或标签"
                aria-label="检索档案"
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
              />
            </label>

            <div className="flex flex-wrap gap-1.5">
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
            </div>

            <span className="ml-auto text-[12px] text-[var(--muted)]">
              当前显示 {formatCount(filtered.length)} / {formatCount(items.length)} 条
            </span>
            {hasHiddenFilters && (
              <button
                type="button"
                onClick={clearExtras}
                className="text-[12px] text-[var(--accent)] underline underline-offset-4"
              >
                清除其他筛选
              </button>
            )}
          </div>

          {missingSlug && (
            <div role="status" className="mt-4 border-l-2 border-[var(--accent-mark)] pl-3">
              <p className="text-[13.5px] leading-6 text-[var(--ink-soft)]">
                地址中的条目「{missingSlug}」没有找到，可能已被合并，或尚未同步到本页。
              </p>
              <button
                type="button"
                onClick={dismissMissingSlug}
                className="mt-1 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[var(--accent)] underline underline-offset-4"
              >
                回到时间轴
              </button>
            </div>
          )}

          {truncated && (
            <p className="mt-4 border-l-2 border-[var(--accent-mark)] pl-3 text-[12.5px] leading-6 text-[var(--ink-soft)]">
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
              <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-7 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-9">
                <div className="min-w-0">
                  {groups.map((group) => (
                    <YearGrid
                      key={group.year}
                      year={group.year}
                      items={group.items}
                      expandedId={expandedId}
                      onToggle={toggleRow}
                      onKeyword={focusKeyword}
                    />
                  ))}

                  <div className="mu-green mt-10 grid items-center gap-6 rounded-[10px] px-6 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-8 lg:py-[30px]">
                    <div>
                      <h2 className="font-serif text-[25px] tracking-[-0.01em]">把这份档案带走</h2>
                      <p className="mt-[7px] max-w-[56ch] text-[13.6px] text-[#c3b898]">
                        订阅每周简报，或申请 API Key 把结构化事件、证据与原链接入你的产品与研究流程。
                        免费额度每秒 5 次，通常 1 个工作日内开通。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      <a
                        href="/api/v1/subscribe?src=band"
                        className="inline-flex h-11 items-center rounded-[6px] bg-[var(--accent-mark)] px-5.5 text-[14.5px] font-semibold text-[#20180a] transition-colors hover:bg-[#c29c58]"
                      >
                        订阅更新
                      </a>
                      <a
                        href="/api/v1/open/apply"
                        className="inline-flex h-11 items-center rounded-[6px] border border-[#4e6f60] px-5.5 text-[14.5px] font-semibold text-[#e9e0ca] transition-colors hover:border-[#8aa392]"
                      >
                        申请 API →
                      </a>
                    </div>
                  </div>
                </div>

                <div className="hidden lg:sticky lg:top-[9rem] lg:block">
                  <EraBrief year={activeYear ?? groups[0].year} variant="museum" />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="mu-foot mt-11">
        <div className={`${wrap} pb-5 pt-11`}>
          <div className="grid gap-8.5 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1.3fr]">
            <div>
              <a href="/" className="flex items-center gap-2.75 whitespace-nowrap">
                <BrandMark variant="seal" size={30} />
                <span className="font-serif text-[22px] tracking-[0.02em] text-[#f4eeda]">AI 纪年</span>
                <em className="font-sans text-[10px] not-italic uppercase tracking-[0.24em] text-[#8d9c92]">
                  Chronicle
                </em>
              </a>
              <p className="mt-3.5 max-w-[38ch] text-[13px] leading-[1.8] text-[#93a096]">
                按年份编排人工智能的关键事件、模型发布与重要研究。条目来自公开接口与官方公告，
                经去重与交叉验证入档，置信度与证据随每条记录公开。
              </p>
            </div>

            <FootColumn title="浏览">
              <a href="#timeline">时间轴</a>
              <button type="button" onClick={openStandard} className="text-left">
                收录标准
              </button>
              <a href="#method">数据来源</a>
              <a href="/admin/">管理台</a>
            </FootColumn>

            <FootColumn title="开放">
              <a href="/api/v1/open/apply">API 申请</a>
              <a href="/api/v1/timeline?limit=1200">数据下载</a>
              <a href="/api/v1/subscribe?src=footer">订阅更新</a>
              <a href="/api/v1/correct">发现错误</a>
            </FootColumn>

            <div>
              <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">每周一封</h4>
              <div className="mt-3 w-full">
                <SubscribeForm
                  source="footer"
                  inputClass="h-10 min-w-0 flex-1 rounded-[4px] border border-[#345445] bg-[#0a2019] px-2.5 text-[13.5px] text-[#f4eeda] outline-none placeholder:text-[#7f8f86]"
                  buttonClass="ml-1.5 inline-flex h-10 shrink-0 items-center rounded-[4px] bg-[var(--accent-mark)] px-3.5 text-[13px] font-semibold text-[#20180a] hover:bg-[#c29c58]"
                  noteClass="text-[11.5px] leading-5 text-[#7f8f86]"
                />
              </div>
              <small className="mt-2 block text-[11.5px] text-[#7f8f86]">
                {notice} · 只写新增，随时退订
              </small>
            </div>
          </div>

          <div
            id="method"
            className="mt-8 grid gap-6 border-t border-[#26463a] pt-5 text-[12.5px] leading-[1.75] text-[#93a096] sm:grid-cols-2 lg:gap-10"
          >
            <p>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent-mark)]">
                采集
              </span>
              <br />
              OpenRouter、Hugging Face、arXiv、Hacker News、OpenAI 与 Google 官方博客、
              Anthropic 站点地图，以及 TechCrunch、The Verge、MIT Technology Review。
              同一来源只计一次，跨类别命中才升级为「已证实」。
            </p>
            <p>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent-mark)]">
                边界
              </span>
              <br />
              后台定时任务每天 01:05 运行一次，浏览页面不发起任何同步。自动条目先经规则预筛，
              再由五家厂商各一席的模型评审：至少三票同意、中位分不低于 75 才收录；
              票型分裂或评审不可用时暂缓并隐藏。
            </p>
          </div>

          <FooterSites tone="museum" className="mt-5" />

          <div className="mt-4 flex flex-wrap items-center gap-x-5.5 gap-y-2.5 border-t border-[#26463a] py-3.5 text-[12px] text-[#8d9c92]">
            <span>
              © {new Date().getFullYear()} AI 纪年 · Vol. I · {panelSeats || "—"} 席评审
            </span>
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

function Promise({
  mark,
  title,
  children,
}: {
  mark: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-[13px] bg-[var(--surface)] px-5 py-[18px]">
      <span className="grid h-[30px] w-[30px] flex-none place-items-center border border-[var(--accent-mark)] font-serif text-[14px] text-[var(--accent-mark)]">
        {mark}
      </span>
      <div>
        <h3 className="text-[14px] font-semibold text-[var(--ink)]">{title}</h3>
        <p className="mt-[3px] text-[12.6px] leading-[1.6] text-[var(--muted)]">{children}</p>
      </div>
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
      className={`inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] transition-colors ${
        pressed
          ? "border-[var(--deep)] bg-[var(--deep)] text-[#f4eeda]"
          : "border-[var(--rule-strong)] text-[var(--ink-soft)] hover:border-[var(--deep)] hover:text-[var(--deep)]"
      }`}
    >
      {label}
      <span className="text-[10.5px] opacity-65">{formatCount(count)}</span>
    </button>
  );
}

function YearGrid({
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
      className="mt-[30px] scroll-mt-[8rem]"
      aria-labelledby={`year-heading-${year}`}
    >
      <div className="flex items-baseline gap-3.5 border-b border-[var(--rule-strong)] pb-2.5">
        <h2
          id={`year-heading-${year}`}
          className="font-serif text-[30px] leading-none tracking-[-0.01em] text-[var(--ink)]"
        >
          {year}
        </h2>
        <span className="truncate font-mono text-[11.5px] font-bold uppercase tracking-[0.14em] text-[var(--accent-mark)]">
          {era.kind === "winter" ? `低谷 · ${era.title}` : era.title}
        </span>
        <span className="ml-auto shrink-0 text-[12px] text-[var(--muted)]">{items.length} 条</span>
      </div>

      <EraNote year={year} />

      <div className="mt-3.5 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <Card
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={onToggle}
            onKeyword={onKeyword}
          />
        ))}
      </div>
    </section>
  );
}

function Card({
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
  const detailId = `entry-detail-${item.id}`;
  const families = (item.sourceFamilies || []).map(familyLabel);
  const evidence = families.length ? families.slice(0, 3).join("、") : "公开来源";

  return (
    <article id={`entry-${item.slug || item.id}`} className="mu-card px-[17px] py-[15px]">
      <div className="flex flex-wrap items-center gap-x-[7px] gap-y-1 text-[11.5px] text-[var(--muted)]">
        <span className="tabular-nums text-[var(--ink)]">
          {shortDate(item.eventDate, item.datePrecision)}
        </span>
        <span className={`rounded-[3px] px-[7px] py-px text-[11px] ${CATEGORY_TONE[item.category]}`}>
          {meta.short}
        </span>
        {(item.organization || item.vendor) && (
          <span className="truncate">{item.organization || item.vendor}</span>
        )}
        <span
          className={`ml-auto inline-flex items-center gap-[5px] ${
            CONFIDENCE_TONE[item.confidence] || CONFIDENCE_TONE.single
          }`}
        >
          <i className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden="true" />
          {CONFIDENCE_META[item.confidence]?.label ?? "—"}
        </span>
      </div>

      <h3 className="font-serif text-[18.5px] leading-[1.4] tracking-[-0.005em] text-[var(--ink)]">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-expanded={expanded}
          aria-controls={detailId}
          className="text-left transition-colors hover:text-[var(--deep)]"
        >
          {item.title}
        </button>
        {item.titleEn && item.titleEn !== item.title && (
          <span className="ml-1.5 font-sans text-[12px] font-normal text-[var(--muted)]">
            {item.titleEn}
          </span>
        )}
      </h3>

      <p className="text-[13.2px] leading-[1.68] text-[var(--ink-soft)]">
        证据来自{evidence}，共 {item.sourceCount} 条链接 · 重要度 {item.importance} / 100。
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-dashed border-[var(--rule)] pt-2 text-[11.5px] text-[var(--muted)]">
        <span>来源 {item.sourceCount} 条</span>
        {item.tags.slice(0, 2).map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onKeyword(tag)}
            className="text-[#1c5340] transition-colors hover:text-[var(--accent-mark)]"
            aria-label={`按关键词「${tag}」筛选档案`}
          >
            #{tag}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-expanded={expanded}
          aria-controls={detailId}
          className="ml-auto text-[12px] font-semibold text-[var(--deep)]"
        >
          {expanded ? "收起 ↑" : "展开 →"}
        </button>
      </div>

      {expanded && (
        <div id={detailId} className="border-t border-dashed border-[var(--rule)] pt-3">
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
      <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">{title}</h4>
      <ul className="mt-3 flex list-none flex-col gap-2.25 p-0 text-[13.5px]">{children}</ul>
    </div>
  );
}
