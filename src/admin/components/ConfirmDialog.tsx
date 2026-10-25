import { useEffect, useState, type ReactNode } from "react";
import { Button, INPUT_CLASS } from "./Field";

/**
 * Every write in the console passes through here.
 *
 * The reason field is part of the component, not the caller's job, because the
 * reason is what lands in `audit_log.detail.note` — an action whose rationale is
 * missing from the audit trail is an action nobody can review in six months.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  detail?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger" | "default";
  /** Extra control between the detail and the reason, e.g. a new importance. */
  extra?: ReactNode;
  /** Require a non-empty reason before the confirm button unlocks. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel = "确认",
  tone = "primary",
  extra,
  requireReason = true,
  reasonLabel = "理由（写入审计）",
  reasonPlaceholder = "为什么做这个处置，供未来回看",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const blocked = busy || (requireReason && reason.trim().length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="取消"
        onClick={() => (busy ? undefined : onCancel())}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div className="relative w-full max-w-md rounded-[var(--c-radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)] shadow-2xl shadow-black/70">
        <h2 className="border-b border-[var(--c-line)] px-4 py-2.5 text-[13px] text-[var(--c-text)]">
          {title}
        </h2>
        <div className="space-y-3 px-4 py-3">
          {detail && <div className="text-[11px] leading-5 text-[var(--c-text-dim)]">{detail}</div>}
          {extra}
          {requireReason && (
            <label className="block">
              <span className="label">{reasonLabel}</span>
              <textarea
                autoFocus
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={reasonPlaceholder}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--c-line)] px-4 py-2.5">
          <Button tone="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button tone={tone} onClick={() => onConfirm(reason.trim())} disabled={blocked}>
            {busy ? "执行中…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
