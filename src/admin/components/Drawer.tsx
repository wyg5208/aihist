import { useEffect, useRef, type ReactNode } from "react";

/**
 * Right-hand sheet for record detail.
 *
 * A drawer rather than a route so the list keeps its scroll position and filters:
 * an operator works through a queue, closing one record and opening the next.
 * Escape closes, focus enters on open and returns to the trigger on close.
 */

export interface DrawerProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Drawer({ open, title, subtitle, onClose, children, footer, width = "38rem" }: DrawerProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/55"
      />
      <div
        ref={panel}
        tabIndex={-1}
        style={{ width: `min(${width}, 100vw)` }}
        className="relative flex h-full flex-col border-l border-[var(--c-line-strong)] bg-[var(--c-surface)] shadow-2xl shadow-black/60 outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--c-line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] leading-6 text-[var(--c-text)]">{title}</h2>
            {subtitle && <div className="mt-1 text-[11px] text-[var(--c-text-mute)]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--c-radius)] border border-[var(--c-line)] px-2 py-0.5 font-mono text-[10px] text-[var(--c-text-dim)] hover:border-[var(--c-line-strong)]"
          >
            关闭
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer && (
          <footer className="border-t border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
