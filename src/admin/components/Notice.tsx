import { useCallback, useRef, useState } from "react";

/**
 * Transient feedback for actions that leave the page otherwise unchanged.
 *
 * A decision on a hold row refreshes the table; the row simply appears in its new
 * state and there is no diff to see. The notice is what confirms the write
 * landed, and it carries the audit-facing wording ("已写审计记录").
 */

export type NoticeTone = "ok" | "warn" | "danger" | "info";

export interface NoticeItem {
  id: number;
  tone: NoticeTone;
  text: string;
}

const TONE_CLASS: Record<NoticeTone, string> = {
  ok: "border-[var(--c-ok-line)] bg-[var(--c-ok-bg)] text-[var(--c-ok)]",
  warn: "border-[var(--c-warn-line)] bg-[var(--c-warn-bg)] text-[var(--c-warn)]",
  danger: "border-[var(--c-danger-line)] bg-[var(--c-danger-bg)] text-[var(--c-danger)]",
  info: "border-[var(--c-info-line)] bg-[var(--c-info-bg)] text-[var(--c-info)]",
};

export function useNotices() {
  const [items, setItems] = useState<NoticeItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: NoticeTone, text: string) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), tone === "danger" ? 8000 : 4500);
      return id;
    },
    [dismiss],
  );

  return { items, push, dismiss };
}

export type Notices = ReturnType<typeof useNotices>;

export function NoticeStack({
  items,
  onDismiss,
}: {
  items: NoticeItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          onClick={() => onDismiss(item.id)}
          className={`pointer-events-auto rounded-[var(--c-radius)] border px-3 py-2 text-left text-[12px] leading-5 shadow-lg ${TONE_CLASS[item.tone]}`}
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}
