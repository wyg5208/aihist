import type { ReactNode } from "react";
import type { Confidence, TimelineItem } from "../types";
import { BrandMark } from "../components/BrandMark";
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
  formatCount,
  relativeTime,
  splitDate,
} from "../lib/format";

const wrap = "mx-auto w-full max-w-[1460px] px-[18px] sm:px-8";

const CONFIDENCE_TONE: Record<Confidence, string> = {
  verified: "border-[#9db9a9] bg-[#eef5ef] text-[#245c3c]",
  likely: "border-[#d5c49a] bg-[#faf3e2] text-[#7a5a1e]",
  single: "border-dashed border-[var(--rule-strong)] text-[var(--muted)]",
};

const LINK = "text-[#1b4a72] transition-colors hover:text-[var(--accent-mark)]";

/**
 * 01 · 典藏卷轴.
 *
 * A printed卷: an ink strip for the archive's vitals, a masthead with the year
 * span, a two-column opening (statement left, the three numbers right), the
 * three ways in, then one sticky toolbar over hairline-separated rows. Heights
 * here are deliberately not the other views': 68px header, 58px toolbar, and a
 * year heading that parks under both.
 */
export function EditorialView({ archive }: { archive: ArchiveController }) {
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
    confidence,
    vendor,
    setQuery,
    setCategory,
    setConfidence,
    setVendor,
    clearFilters,
    clearExtras,
    focusKeyword,
    hasHiddenFilters,
    categoryCounts,
    vendorOptions,
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
    openStandard,
  } = archive;

  const showLoading = phase === "loading";
  const showError = phase === "error";
  const hasArchive = items.length > 0;

  return (
    <div className="min-h-dvh">
      <div className="ed-strip text-[11.5px] tracking-[0.12em]">
        <div className={`${wrap} flex h-[34px] items-center justify-between gap-4`}>
          <span className="truncate">
            <b className="font-semibold text-[#f4ead6]">1912—{new Date().getFullYear()}</b>
            {" · "}公开来源采集 · 每日 01:05 同步 · 最近更新
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

      <header className="ed-nav">
        <div className={`${wrap} flex h-[68px] items-center gap-7`}>
          <a href="/" className="flex items-center gap-2.5 whitespace-nowrap">
            <BrandMark />
            <span className="font-serif text-[22px] tracking-[0.02em] text-[var(--ink)]">
              AI 纪年
            </span>
            <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--muted)] sm:inline">
              Chronicle
            </span>
          </a>

          <nav aria-label="主导航" className="hidden items-center gap-6 text-[14px] text-[var(--ink-soft)] lg:flex">
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

          <div className="ml-auto flex items-center gap-2.5">
            <ThemeSwitcher />
            <a
              className="hidden h-[34px] items-center border border-[var(--rule-strong)] px-3.5 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-[var(--surface)] sm:inline-flex"
              href="/api/v1/open/apply"
            >
              API 申请
            </a>
            <a
              className="inline-flex h-[34px] items-center bg-[var(--accent-mark)] px-3.5 text-[12.5px] font-semibold text-[#1b1206] transition-colors hover:bg-[#b88a45]"
              href="/api/v1/subscribe?src=nav"
            >
              订阅更新
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="pb-14">
        <section className="border-b border-[var(--rule)] pb-9 pt-12">
          <div className={wrap}>
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-12">
              <div>
                <p className="flex items-center gap-2.5 font-mono text-[11.5px] font-bold uppercase tracking-[0.2em] text-[var(--accent-mark)]">
                  <span className="h-px w-[34px] bg-[var(--accent-mark)]" aria-hidden="true" />
                  Vol. I · 1912 — {new Date().getFullYear()}
                </p>
                <h1 className="mt-4 font-serif text-[clamp(46px,6.2vw,82px)] leading-[0.98] tracking-[-0.015em] text-[var(--ink)]">
                  AI 纪年
                  <small className="mt-3.5 block font-sans text-[15px] font-normal tracking-[0.3em] text-[var(--muted)]">
                    人工智能发展编年史
                  </small>
                </h1>
                <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.78] text-[var(--ink-soft)]">
                  从 1912 年的象棋自动机到 2026 年的前沿模型，按年份编排人工智能的关键事件、模型发布与重要研究。
                  每条记录都附
                  <b className="border-b border-[var(--accent-mark)] font-semibold text-[var(--ink)]">
                    来源、证据与置信度
                  </b>
                  ，自动条目还要经五家厂商各一席的模型评审，至少三票同意才入档。
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <a
                    href="#timeline"
                    className="inline-flex h-[38px] items-center bg-[var(--accent-mark)] px-4.5 text-[13.5px] font-semibold text-[#1b1206] transition-colors hover:bg-[#b88a45]"
                  >
                    开始浏览档案 →
                  </a>
                  <a
                    href="/api/v1/open/apply"
                    className="inline-flex h-[38px] items-center border border-[var(--rule-strong)] px-4.5 text-[13.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-[var(--surface)]"
                  >
                    申请 API Key
                  </a>
                  <span className="text-[12.5px] leading-5 text-[var(--muted)]">
                    每周一封，只写新增 · API 免费额度每秒 5 次
                  </span>
                </div>
              </div>

              <aside className="ed-panel px-5 pb-4 pt-4" aria-label="档案速览">
                <h2 className="font-mono text-[11.5px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  档案速览
                </h2>
                <dl className="mt-3.5 grid grid-cols-2 gap-px bg-[var(--rule)]">
                  <Stat value={formatCount(total)} label="已入档条目" />
                  <Stat value={formatCount(evidenceCount)} label="引用链接" />
                  <Stat value={formatCount(familyCount)} label="来源类别" />
                  <Stat value={panelSeats ? String(panelSeats) : "—"} label="评审席位" />
                </dl>
                <p className="mt-3.5 flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                  <span
                    className="h-[7px] w-[7px] rounded-full bg-[var(--ok)]"
                    style={{ boxShadow: "0 0 0 3px color-mix(in srgb, var(--ok) 15%, transparent)" }}
                    aria-hidden="true"
                  />
                  {running ? "后台正在采集" : notice}
                </p>
                <div className="mt-3 flex flex-wrap gap-3.5 border-t border-[var(--rule)] pt-3 text-[12.5px]">
                  <a className={LINK} href="/api/v1/open/apply">
                    开放 API 文档
                  </a>
                  <a className={LINK} href="/api/v1/timeline?limit=1200">
                    数据下载
                  </a>
                  <a className={LINK} href="/api/v1/correct">
                    纠错
                  </a>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section className="pt-7" aria-label="订阅、接口与共建">
          <div className={wrap}>
            <div className="grid gap-3.5 lg:grid-cols-[1.25fr_1fr_1fr]">
              <div className="ed-band-primary flex flex-col gap-2.5 px-5 py-5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-mark)]">
                  保持同步 · Subscribe
                </span>
                <h2 className="font-serif text-[20px] leading-[1.3]">
                  每周一封邮件，只写这一周新增了什么
                </h2>
                <p className="text-[13.5px] leading-[1.65] text-[#c8bfae]">
                  模型发布、重要论文与政策变化，附来源与原链。不发广告，随时退订。
                </p>
                <div className="mt-auto pt-1">
                  <SubscribeForm
                    source="band"
                    inputClass="h-[38px] min-w-0 flex-1 border border-r-0 border-[#33465c] bg-[#16273a] px-3 text-[14px] text-[#f6efe1] outline-none placeholder:text-[#8b96a4]"
                    buttonClass="h-[38px] bg-[var(--accent-mark)] px-4 text-[13.5px] font-semibold text-[#1b1206] hover:bg-[#b88a45]"
                    noteClass="text-[11.5px] leading-5 text-[#8f9aa8]"
                  />
                </div>
                <span className="text-[11.5px] text-[#8f9aa8]">
                  提交即表示同意接收邮件 · 随时可退订
                </span>
              </div>

              <div className="flex flex-col gap-2.5 border border-[var(--rule)] bg-[var(--surface)] px-5 py-5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  开发者 · Open API
                </span>
                <h2 className="font-serif text-[20px] leading-[1.3]">把这份档案接进你的产品</h2>
                <p className="text-[13.5px] leading-[1.65] text-[var(--ink-soft)]">
                  REST 接口，返回结构化事件、证据链接与置信度。免费额度每秒 5 次。
                </p>
                <div className="mt-auto pt-1">
                  <a
                    href="/api/v1/open/apply"
                    className="inline-flex h-[34px] items-center border border-[var(--rule-strong)] px-3.5 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-white"
                  >
                    申请 API Key
                  </a>
                </div>
                <span className="text-[11.5px] text-[var(--muted)]">通常 1 个工作日内开通</span>
              </div>

              <div className="flex flex-col gap-2.5 border border-[var(--rule)] bg-[var(--surface)] px-5 py-5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  共建 · Contribute
                </span>
                <h2 className="font-serif text-[20px] leading-[1.3]">发现错漏，或推荐一条记录</h2>
                <p className="text-[13.5px] leading-[1.65] text-[var(--ink-soft)]">
                  每条记录都可追溯。指出问题会进入人工复核队列，修订记录公开可见。
                </p>
                <div className="mt-auto pt-1">
                  <a
                    href="/api/v1/correct"
                    className="inline-flex h-[34px] items-center border border-[var(--rule-strong)] px-3.5 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-white"
                  >
                    提交纠错
                  </a>
                </div>
                <span className="text-[11.5px] text-[var(--muted)]">收录标准公开可查</span>
              </div>
            </div>
          </div>
        </section>

        <div className="ed-toolbar mt-7">
          <div className={`${wrap} flex flex-wrap items-center gap-4 py-3`}>
            <label className="flex h-[38px] min-w-[240px] flex-1 items-center gap-2.5 border border-[var(--rule)] bg-[var(--surface)] px-3">
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
                placeholder="搜索标题、机构、模型或标签，例如：Gemini"
                aria-label="检索档案"
                autoComplete="off"
                spellCheck={false}
                className="h-full w-full bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
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

            <select
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
              aria-label="按厂商筛选"
              className="h-[34px] border border-[var(--rule)] bg-[var(--surface)] px-2 text-[12.5px] text-[var(--ink-soft)]"
            >
              <option value="all">全部厂商</option>
              {vendorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={confidence}
              onChange={(event) =>
                setConfidence(event.target.value as Confidence | "all")
              }
              aria-label="按可信度筛选"
              className="h-[34px] border border-[var(--rule)] bg-[var(--surface)] px-2 text-[12.5px] text-[var(--ink-soft)]"
            >
              <option value="all">全部可信度</option>
              {(Object.keys(CONFIDENCE_META) as Confidence[]).map((key) => (
                <option key={key} value={key}>
                  {CONFIDENCE_META[key].label}
                </option>
              ))}
            </select>

            <span className="ml-auto font-mono text-[12px] text-[var(--muted)]">
              <b className="text-[var(--ink)]">{formatCount(filtered.length)}</b> /{" "}
              {formatCount(items.length)} 条
            </span>
            {hasHiddenFilters && (
              <button
                type="button"
                onClick={clearExtras}
                className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-[var(--accent-mark)] underline underline-offset-4"
              >
                清除其他筛选
              </button>
            )}
          </div>
        </div>

        <div id="timeline" className={`${wrap} scroll-mt-[8rem]`}>
          {missingSlug && (
            <div role="status" className="mt-4 border-l-2 border-[var(--accent-mark)] pl-3">
              <p className="text-[13.5px] leading-6 text-[var(--ink-soft)]">
                地址中的条目「{missingSlug}」没有找到，可能已被合并，或尚未同步到本页。
              </p>
              <button
                type="button"
                onClick={dismissMissingSlug}
                className="mt-1 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[var(--accent-mark)] underline underline-offset-4"
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

              <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border border-[var(--rule)] bg-[var(--surface)] px-5 py-4">
                <p className="text-[13.5px] text-[var(--ink-soft)]">
                  档案到此为止 · 共 <b className="text-[var(--ink)]">{filtered.length}</b> 条记录
                  {filtered.length !== items.length ? `（全档 ${items.length} 条）` : ""}。
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <a
                    href="/api/v1/timeline?limit=1200"
                    className="inline-flex h-[34px] items-center border border-[var(--rule-strong)] px-3.5 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-white"
                  >
                    下载 JSON
                  </a>
                  <a
                    href="/api/v1/open/apply"
                    className="inline-flex h-[34px] items-center border border-[var(--rule-strong)] px-3.5 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-white"
                  >
                    API 接入
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="ed-foot mt-10">
        <div className={`${wrap} pb-5 pt-12`}>
          <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.4fr]">
            <div>
              <a href="/" className="flex items-center gap-2.5 whitespace-nowrap text-[#f6efe1]">
                <BrandMark tone="onDeep" />
                <span className="font-serif text-[22px] tracking-[0.02em]">AI 纪年</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#8d949f]">
                  Chronicle
                </span>
              </a>
              <p className="mt-3.5 max-w-[40ch] text-[13.2px] leading-[1.85] text-[#a9b1bd]">
                按年份编排人工智能的关键事件、模型发布与重要研究。条目来自公开接口与官方公告，
                经过去重与交叉验证入档，置信度与证据随每条记录公开。
              </p>
            </div>

            <FootColumn title="浏览">
              <a href="#timeline" className="text-[#c9cfd8] hover:text-white">
                时间轴
              </a>
              <button type="button" onClick={openStandard} className="text-left text-[#c9cfd8] hover:text-white">
                收录标准
              </button>
              <a href="#method" className="text-[#c9cfd8] hover:text-white">
                数据来源
              </a>
              <a href="/admin/" className="text-[#c9cfd8] hover:text-white">
                管理台
              </a>
            </FootColumn>

            <FootColumn title="开放">
              <a href="/api/v1/open/apply" className="text-[#c9cfd8] hover:text-white">
                API 申请
              </a>
              <a href="/api/v1/timeline?limit=1200" className="text-[#c9cfd8] hover:text-white">
                数据下载
              </a>
              <a href="/api/v1/correct" className="text-[#c9cfd8] hover:text-white">
                发现错误
              </a>
              <a href="/api/v1/subscribe?src=footer" className="text-[#c9cfd8] hover:text-white">
                订阅更新
              </a>
            </FootColumn>

            <FootColumn title="每周一封">
              <p className="text-[13px] leading-[1.75] text-[#a9b1bd]">
                只写这一周新增了什么，附来源与原链。
              </p>
              <div className="w-full">
                <SubscribeForm
                  source="footer"
                  inputClass="h-[40px] min-w-0 flex-1 border border-r-0 border-[#33465c] bg-[#16273a] px-3 text-[14px] text-[#f6efe1] outline-none placeholder:text-[#7f8a98]"
                  buttonClass="h-[40px] bg-[var(--accent-mark)] px-4 text-[13.5px] font-semibold text-[#1b1206] hover:bg-[#b88a45]"
                  noteClass="text-[11.5px] leading-5 text-[#7d8794]"
                />
              </div>
              <small className="text-[11.5px] text-[#7d8794]">
                {notice} · 随时退订
              </small>
            </FootColumn>
          </div>

          <div
            id="method"
            className="mt-9 grid gap-6 border-t border-[#2a3a4d] pt-6 text-[12.5px] leading-[1.75] text-[#a9b1bd] sm:grid-cols-2 lg:gap-10"
          >
            <p>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent-mark)]">
                采集
              </span>
              <br />
              OpenRouter、Hugging Face、arXiv、Hacker News、OpenAI 与 Google 官方博客、
              Anthropic 站点地图，以及 TechCrunch、The Verge、MIT Technology Review；
              中文侧采集量子位、InfoQ 中国、钛媒体与雷峰网。同一来源只计一次，
              跨类别命中才升级为「已证实」。
            </p>
            <p>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent-mark)]">
                边界
              </span>
              <br />
              采集与访问完全解耦：后台定时任务每天 01:05 运行一次，浏览页面不发起任何同步。
              自动条目先经规则预筛，再由五家厂商各一席的模型评审：至少三票同意、中位分不低于 75
              才收录；票型分裂或评审不可用时暂缓并隐藏。
            </p>
          </div>

          <FooterSites tone="editorial" className="mt-6" />

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[#2a3a4d] pt-4 text-[12px] text-[#8d949f]">
            <span>
              © {new Date().getFullYear()} AI 纪年 · Vol. I · {modelCount} 条模型发布
            </span>
            <span className="flex flex-wrap gap-5">
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-[var(--surface)] px-2.5 pb-3 pt-3">
      <dd className="font-serif text-[29px] leading-none tracking-[-0.02em] text-[var(--ink)]">
        {value}
      </dd>
      <dt className="mt-1.5 text-[12px] text-[var(--muted)]">{label}</dt>
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
      className={`inline-flex h-8 items-center gap-1.5 border px-3 text-[12.5px] transition-colors ${
        pressed
          ? "border-[var(--ink)] bg-[var(--ink)] text-[#f7f0e2]"
          : "border-[var(--rule)] text-[var(--ink-soft)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
      <span className={`text-[11px] ${pressed ? "opacity-60" : "opacity-70"}`}>
        {formatCount(count)}
      </span>
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
      className="mt-8 first:mt-6 scroll-mt-[8.5rem]"
      aria-labelledby={`year-heading-${year}`}
    >
      <div className="ed-year-head flex items-baseline gap-3.5 border-b-2 border-[var(--ink)] pb-2.5">
        <h2
          id={`year-heading-${year}`}
          className="font-serif text-[30px] leading-none tracking-[-0.02em] text-[var(--ink)]"
        >
          {year}
        </h2>
        <span className="truncate font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--accent-mark)]">
          {era.kind === "winter" ? `低谷 · ${era.title}` : era.title}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[12px] text-[var(--muted)]">
          {items.length} 条
        </span>
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
  const parts = splitDate(item.eventDate, item.datePrecision);
  const detailId = `entry-detail-${item.id}`;
  const tone = CONFIDENCE_TONE[item.confidence] || CONFIDENCE_TONE.single;

  return (
    <article
      id={`entry-${item.slug || item.id}`}
      className="entry-row border-b border-[var(--rule)]"
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 py-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-x-5">
        <div className="pt-0.5 font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
          <b className="block text-[15px] font-semibold tracking-[0.01em] text-[var(--ink)]">
            {parts.main}
          </b>
          {parts.year}
          <span className="mt-1.5 block w-fit border border-[var(--rule-strong)] px-1.5 py-px text-[11px] tracking-[0.08em] text-[var(--ink-soft)]">
            {meta.short}
          </span>
        </div>

        <div className="min-w-0">
          <h3 className="font-serif text-[19.5px] leading-[1.42] tracking-[-0.005em] text-[var(--ink)]">
            <button
              type="button"
              onClick={() => onToggle(item.id)}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="text-left transition-colors hover:text-[#1b4a72]"
            >
              {item.title}
            </button>
            {item.titleEn && item.titleEn !== item.title && (
              <span className="ml-1.5 font-sans text-[12.5px] font-normal text-[var(--muted)]">
                {item.titleEn}
              </span>
            )}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12px] text-[var(--muted)]">
            <span
              className={`inline-flex items-center gap-1.5 border px-1.5 py-px text-[11px] tracking-[0.06em] ${tone}`}
            >
              {item.confidence === "verified" && (
                <span className="h-[5px] w-[5px] rounded-full bg-[var(--ok)]" aria-hidden="true" />
              )}
              {CONFIDENCE_META[item.confidence]?.label ?? "—"}
            </span>
            {item.organization && (
              <>
                <span className="h-[11px] w-px bg-[var(--rule)]" aria-hidden="true" />
                <span>{item.organization}</span>
              </>
            )}
            <span className="h-[11px] w-px bg-[var(--rule)]" aria-hidden="true" />
            <span>来源 {item.sourceCount} 条</span>
            {item.tags.slice(0, 2).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onKeyword(tag)}
                className={`text-[12px] ${LINK}`}
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
              className={`ml-auto text-[12px] ${LINK}`}
            >
              {expanded ? "收起证据 ↑" : "展开证据 →"}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div
          id={detailId}
          className="ml-[76px] border-t border-dashed border-[var(--rule)] pb-5 pt-3 sm:ml-[116px]"
        >
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

function FootColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em]">{title}</h4>
      <div className="mt-3.5 flex flex-col items-start gap-2.5 text-[13.5px]">{children}</div>
    </div>
  );
}
