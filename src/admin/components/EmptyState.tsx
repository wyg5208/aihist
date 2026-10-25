import type { ReactNode } from "react";

/**
 * The two states every table and panel needs: nothing here yet, and something
 * broke. Both say what to do next, because "no data" is almost always an action
 * to take (run a sync, configure a log path) rather than a dead end.
 */

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] text-[var(--c-text-dim)]">{title}</p>
      {detail && <p className="max-w-md text-[11px] leading-5 text-[var(--c-text-mute)]">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "加载失败",
  detail,
  action,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] text-[var(--c-danger)]">{title}</p>
      {detail && <p className="max-w-md text-[11px] leading-5 text-[var(--c-text-mute)]">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Rows of grey blocks, sized to the table's own row height. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-[var(--c-line)]">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-3 py-[11px]">
          {Array.from({ length: columns }, (_, column) => (
            <span
              key={column}
              className="skeleton h-3"
              style={{ width: `${column === 0 ? 34 : 12 + ((row + column) % 3) * 6}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
