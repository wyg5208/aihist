import type { ReactNode } from "react";
import { EmptyState, TableSkeleton } from "./EmptyState";

/**
 * One table for all thirteen pages.
 *
 * Sticky header, hover, empty state, skeleton — decided once here rather than in
 * each page. `align: "right"` also sets tabular figures on the cell, because a
 * column of counts that does not line up by digit is a column you cannot scan.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Fixed column width, e.g. `"6rem"`. Everything else shares the remainder. */
  width?: string;
  /** Hide on narrow viewports; the primary column never hides. */
  hideBelow?: "sm" | "md" | "lg";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyDetail?: string;
  emptyAction?: ReactNode;
  /** Row to highlight, e.g. the one open in the detail drawer. */
  activeKey?: string | null;
  footer?: ReactNode;
}

const HIDE_CLASS: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  skeletonRows = 6,
  emptyTitle = "没有符合条件的记录",
  emptyDetail,
  emptyAction,
  activeKey,
  footer,
}: DataTableProps<T>) {
  if (loading && rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)]">
        <TableSkeleton rows={skeletonRows} columns={columns.length} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)]">
        <EmptyState title={emptyTitle} detail={emptyDetail} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)]">
      <div className="max-h-[calc(100dvh-15rem)] overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[var(--c-surface-2)]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`whitespace-nowrap border-b border-[var(--c-line)] px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-[var(--c-text-mute)] ${
                    column.align === "right" ? "text-right" : ""
                  } ${column.hideBelow ? HIDE_CLASS[column.hideBelow] : ""}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const active = activeKey === key;
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-[var(--c-line)] last:border-b-0 transition-colors ${
                    onRowClick ? "cursor-pointer" : ""
                  } ${active ? "bg-[var(--c-surface-2)]" : "hover:bg-[var(--c-surface-2)]/60"}`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 align-top text-[12px] text-[var(--c-text-dim)] ${
                        column.align === "right" ? "num text-right" : ""
                      } ${column.hideBelow ? HIDE_CLASS[column.hideBelow] : ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
