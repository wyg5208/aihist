export function LoadingState() {
  return (
    <div className="px-1 py-16" role="status" aria-live="polite">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
        正在读取档案
      </p>
      <div className="mt-5 space-y-3" aria-hidden="true">
        {[0, 1, 2].map((line) => (
          <div
            key={line}
            className="h-px w-full bg-[var(--rule)]"
            style={{ width: `${92 - line * 18}%` }}
          />
        ))}
      </div>
      <p className="mt-5 text-sm text-[var(--ink-soft)]">
        正在读取已收录的档案。
      </p>
    </div>
  );
}

export function ErrorState({
  code,
  onRetry,
}: {
  code: string | null;
  onRetry: () => void;
}) {
  const message =
    code === "network"
      ? "无法连接档案接口。"
      : code === "internal_error" || code === "database_request_failed"
        ? "档案数据库暂时不可用。"
        : "读取档案时遇到问题。";
  return (
    <div className="border-y border-[var(--rule)] py-14" role="alert">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Archive unavailable
      </p>
      <h2 className="mt-3 font-serif text-2xl">{message}</h2>
      <p className="mt-2 max-w-prose text-sm text-[var(--ink-soft)]">
        已收录的内容不会丢失。请稍后重试。
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 border border-[var(--ink)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] transition-colors motion-safe:hover:bg-[var(--ink)] motion-safe:hover:text-[var(--paper)]"
      >
        重新读取
      </button>
    </div>
  );
}

export function EmptyState({
  reason,
  onClear,
}: {
  reason: "filter" | "archive";
  onClear?: () => void;
}) {
  return (
    <div className="border-y border-[var(--rule)] py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
        {reason === "filter" ? "No matching entries" : "Archive empty"}
      </p>
      <h2 className="mt-3 font-serif text-2xl">
        {reason === "filter" ? "没有符合条件的条目" : "档案尚未建立"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-soft)]">
        {reason === "filter"
          ? "试试放宽类别、置信度或搜索词。"
          : "档案由后台采集任务维护。定时任务完成后，收录的条目会出现在这里。"}
      </p>
      {reason === "filter" && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-6 border border-[var(--ink)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] transition-colors motion-safe:hover:bg-[var(--ink)] motion-safe:hover:text-[var(--paper)]"
        >
          清除筛选
        </button>
      )}
    </div>
  );
}
