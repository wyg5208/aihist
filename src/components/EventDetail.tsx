import { useState } from "react";
import type { EventDetail as Detail } from "../types";
import { citationText } from "../lib/citation";
import { eventUrl, staticPagePath, staticPageUrl } from "../lib/permalink";
import {
  CATEGORY_META,
  familyLabel,
  formatCount,
  formatContext,
  formatFullDate,
  formatModality,
  formatTimestamp,
  hostLabel,
  summaryKindLabel,
} from "../lib/format";

interface Props {
  detail: Detail | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onKeyword?: (keyword: string) => void;
}

interface MetaRow {
  label: string;
  value: string;
}

function extraMeta(meta: Record<string, unknown>): MetaRow[] {
  const rows: MetaRow[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null) return;
    const text = String(value).trim();
    if (!text || text === "undefined" || text === "null") return;
    rows.push({ label, value: text });
  };

  const context = formatContext(meta.contextWindow);
  if (context) rows.push({ label: "上下文", value: context });

  const modality = formatModality(meta.modality as string);
  if (modality) rows.push({ label: "模态", value: modality });

  if (typeof meta.openWeights === "boolean") {
    rows.push({ label: "权重", value: meta.openWeights ? "开放权重" : "闭源接口" });
  }

  if (typeof meta.likes === "number" || typeof meta.downloads === "number") {
    const likes = typeof meta.likes === "number" ? formatCount(meta.likes) : "—";
    const downloads =
      typeof meta.downloads === "number" ? formatCount(meta.downloads) : "—";
    rows.push({ label: "热度", value: `${likes} 赞 · ${downloads} 下载` });
  }

  push("仓库", meta.hfRepo);
  push("arXiv", meta.arxivId);

  if (Array.isArray(meta.categories) && meta.categories.length) {
    rows.push({ label: "分类", value: meta.categories.slice(0, 4).join(" · ") });
  }

  if (typeof meta.hnPoints === "number" && meta.hnPoints > 0) {
    rows.push({
      label: "社区",
      value: `${formatCount(meta.hnPoints)} 分${
        typeof meta.hnComments === "number" ? ` · ${formatCount(meta.hnComments)} 评论` : ""
      }`,
    });
  }

  push("校订注记", meta.research_note);

  return rows;
}

export function EventDetail({
  detail,
  loading,
  error,
  onRetry,
  onKeyword,
}: Props) {
  if (loading) {
    return (
      <div className="pb-6" role="status" aria-live="polite">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
          正在读取证据与摘要
        </p>
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-px w-11/12 bg-[var(--rule)]" />
          <div className="h-px w-3/4 bg-[var(--rule)]" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="pb-6" role="alert">
        <p className="text-[13px] text-[var(--ink-soft)]">
          详情未能读取，时间轴条目本身仍然有效。
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)] underline underline-offset-4"
        >
          重新读取详情
        </button>
      </div>
    );
  }

  const meta = extraMeta(detail.meta);
  const sources = detail.sources;
  const families = new Set(sources.map((source) => source.family));
  const categoryLabel = CATEGORY_META[detail.category]?.label || detail.category;
  const review = detail.editorialReview;
  const votes = review?.votes?.filter((vote) => vote.judge !== "rule") || [];

  return (
    <div className="pb-7">
      <div className="border-l-2 border-[var(--accent)] pl-3 sm:pl-4">
        <p className="text-[13.5px] leading-6 text-[var(--ink-soft)] sm:text-sm">
          {detail.summary}
        </p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
          <span>{summaryKindLabel(detail.summaryKind)}</span>
          <span aria-hidden="true">·</span>
          <span>{detail.origin === "seed" ? "人工校订条目" : "自动聚合条目"}</span>
          <span aria-hidden="true">·</span>
          <span>更新于 {formatTimestamp(detail.updatedAt)}</span>
        </p>
      </div>

      <CopyActions detail={detail} />

      {detail.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
          <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
            关键词
          </span>
          {detail.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="keyword-chip"
              onClick={() => onKeyword?.(tag)}
              aria-label={`按关键词「${tag}」筛选档案`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <dl className="detail-meta mt-4">
        <MetaCell label="日期" value={formatFullDate(detail.eventDate, detail.datePrecision)} />
        <MetaCell
          label="机构 / 模型"
          value={detail.organization || detail.modelName || "—"}
        />
        <MetaCell label="证据来源" value={`${sources.length} 条 · ${families.size} 类`} />
        <MetaCell label="重要度" value={`${detail.importance} / 100`} />
      </dl>

      {review && (
        <div className="mt-4 border border-[var(--rule)] px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h4 className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
              收录评审
            </h4>
            <p className="font-mono text-[9px] tracking-[0.06em] text-[var(--ink-soft)]">
              {review.includeVotes}/{review.validVotes} 票同意 · 中位分 {review.score} ·{" "}
              {review.version}
            </p>
          </div>
          {votes.length > 0 && (
            <ol className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-3">
              {votes.map((vote, index) => (
                <li
                  key={`${vote.judge}-${index}`}
                  className="border-t border-[var(--rule)] pt-1.5"
                >
                  <p className="flex items-baseline justify-between gap-2 font-mono text-[9px]">
                    <span className="min-w-0 truncate text-[var(--muted)]" title={vote.model}>
                      {vote.model}
                    </span>
                    <span
                      className={
                        vote.vote === "include"
                          ? "shrink-0 text-[var(--ink)]"
                          : "shrink-0 text-[var(--accent)]"
                      }
                    >
                      {vote.vote === "include" ? "同意" : "反对"} · {vote.score}
                    </span>
                  </p>
                  {vote.reason && (
                    <p className="mt-0.5 text-[10.5px] leading-4 text-[var(--muted)]">
                      {vote.reason}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 font-mono text-[9px] tracking-[0.04em] text-[var(--muted)]">
            {review.source === "rule" ? "规则预筛" : "三个独立模型分别打分"} ·{" "}
            {formatTimestamp(review.at)}
          </p>
        </div>
      )}

      {meta.length > 0 && (
        <div className="mt-4">
          <h4 className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
            结构化附注
          </h4>
          <dl className="mt-1.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {meta.map((row) => (
              <div key={`${row.label}-${row.value}`} className="flex items-baseline gap-3">
                <dt className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted)]">
                  {row.label}
                </dt>
                <dd className="min-w-0 break-words text-[12px] text-[var(--ink-soft)]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-5">
        <h4 className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
          证据链 · {sources.length} 条
        </h4>
        <ol className="mt-1.5 border-t border-[var(--rule)]">
          {sources.map((source, index) => (
            <li key={`${source.url}-${index}`} className="evidence-item">
              <span className="evidence-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--accent)]">
                    {familyLabel(source.family)}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.06em] text-[var(--muted)]">
                    {source.name}
                  </span>
                  {source.publishedAt && (
                    <span className="font-mono text-[9px] text-[var(--muted)]">
                      {source.publishedAt.slice(0, 10)}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--ink-soft)]">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-link break-words"
                  >
                    {source.title || source.url}
                  </a>
                </p>
                <p className="mt-0.5 font-mono text-[9px] text-[var(--muted)]">
                  {hostLabel(source.url)}
                </p>
              </div>
            </li>
          ))}
          {sources.length === 0 && (
            <li className="py-3 text-[12px] text-[var(--muted)]">暂无可用证据链接。</li>
          )}
        </ol>
      </div>

      <p className="mt-4 border-t border-[var(--rule)] pt-2 font-mono text-[9px] tracking-[0.08em] text-[var(--muted)]">
        档案编号 {detail.fingerprint.slice(0, 16).toUpperCase()}
        <span className="mx-2" aria-hidden="true">·</span>
        类别「{categoryLabel}」
        <span className="mx-2" aria-hidden="true">·</span>
        首次入档 {formatTimestamp(detail.firstSeenAt)}
      </p>
    </div>
  );
}

async function copyText(text: string) {
  let clipboardError: unknown = null;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(area);
  if (!copied) throw clipboardError || new Error("copy_failed");
}

function CopyActions({ detail }: { detail: Detail }) {
  const [notice, setNotice] = useState("");
  const slug = detail.slug;
  const isSeed = detail.origin === "seed";
  const staticPath = isSeed && slug ? staticPagePath(slug) : null;
  const staticUrl = isSeed && slug ? staticPageUrl(slug) : null;

  const copy = async (text: string, message: string) => {
    try {
      await copyText(text);
      setNotice(message);
    } catch {
      setNotice("复制失败，请手动选择地址");
    }
    window.setTimeout(() => setNotice(""), 2400);
  };

  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.16em]">
      <button
        type="button"
        disabled={!slug}
        onClick={() => slug && copy(eventUrl(slug, true), "永久链接已复制")}
        className="text-[var(--accent)] underline underline-offset-4 disabled:cursor-not-allowed disabled:text-[var(--muted)] disabled:no-underline"
      >
        复制永久链接
      </button>
      <button
        type="button"
        disabled={!slug}
        onClick={() =>
          slug &&
          copy(
            citationText({ ...detail, url: staticUrl }),
            "引用已复制"
          )
        }
        className="text-[var(--accent)] underline underline-offset-4 disabled:cursor-not-allowed disabled:text-[var(--muted)] disabled:no-underline"
      >
        复制引用
      </button>
      {staticPath && (
        <a
          href={staticPath}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] underline underline-offset-4"
        >
          静态引用页 ↗
        </a>
      )}
      {!slug && (
        <span className="normal-case tracking-normal text-[var(--muted)]">
          永久地址将在下次同步后生成
        </span>
      )}
      <span
        role="status"
        aria-live="polite"
        className="normal-case tracking-normal text-[var(--muted)]"
      >
        {notice}
      </span>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
