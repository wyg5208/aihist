import { useState } from "react";
import { ApiError } from "../../api";
import {
  contentApi,
  type AdminEventDetail,
  type DecisionAction,
  type DecisionPayload,
} from "../api";
import { useShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState, TableSkeleton } from "../components/EmptyState";
import { Button, Card, Field, TextInput } from "../components/Field";
import { StatusPill } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";
import { useCan } from "../session";
import { originLabel, relativeTime, stamp } from "../format";

/**
 * One entry, and every action that can be taken on it.
 *
 * There is no delete. `exclude` sets `editorial_status` and the row drops out of
 * every public endpoint on the next request while the record, its evidence and
 * its ballots stay in the database — which is what makes "why is this gone"
 * answerable a year later.
 *
 * Every action requires a reason, because the reason is the only part of the
 * audit row that a future reader cannot reconstruct from the data.
 */

interface Spec {
  title: string;
  confirm: string;
  tone: "primary" | "danger" | "default";
  detail: string;
  reasonLabel?: string;
  needsImportance?: boolean;
}

const SPECS: Record<DecisionAction, Spec> = {
  admit: {
    title: "人工入档",
    confirm: "确认入档",
    tone: "primary",
    detail: "公开接口立即返回该条目，评审记录标记为 manual / admitted。",
  },
  exclude: {
    title: "下架条目",
    confirm: "确认下架",
    tone: "danger",
    detail:
      "公开接口对该条立即 404，且不再进入任何列表。记录与证据保留在库中供审计，可随时重新入档。",
  },
  hold: {
    title: "置为暂缓",
    confirm: "确认暂缓",
    tone: "default",
    detail: "撤出公开列表，等待人工复核或下一轮面板重判。",
  },
  "re-review": {
    title: "重新评审",
    confirm: "清票重判",
    tone: "danger",
    detail:
      "删除该 fingerprint 的既有评审票并置为暂缓；下一次采集会重新走一遍 panel 判定，本次投票不会再被复用。",
  },
  importance: {
    title: "调整重要度",
    confirm: "保存重要度",
    tone: "default",
    detail: "重要度只影响列表排序与首页取数，不改变收录状态。",
    needsImportance: true,
  },
  note: {
    title: "写内部按语",
    confirm: "保存按语",
    tone: "default",
    detail: "按语只在后台可见，永不进入公开 payload；适合记录「为什么下架 / 为什么人工入档」。",
    reasonLabel: "按语内容（写入 ops_note 与审计）",
  },
};

const ACTIONS: DecisionAction[] = ["admit", "exclude", "hold", "re-review", "importance", "note"];

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="num mt-0.5 text-[11px] text-[var(--c-text-dim)]">{value}</p>
    </div>
  );
}

function VoteTable({ review }: { review: NonNullable<AdminEventDetail["editorialReview"]> }) {
  const votes = review.votes ?? [];
  if (votes.length === 0) {
    return <p className="text-[11px] text-[var(--c-text-mute)]">这条记录没有留下逐票明细。</p>;
  }
  return (
    <table className="w-full border-collapse text-left text-[11px]">
      <thead>
        <tr className="bg-[var(--c-surface-2)]">
          {["评委", "模型", "票", "分数", "标记"].map((header) => (
            <th
              key={header}
              className="px-2 py-1.5 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--c-text-mute)]"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {votes.map((vote, index) => {
          const include = String(vote.vote ?? "").toLowerCase() === "include";
          return (
            <tr key={index} className="border-b border-[var(--c-line)] last:border-b-0">
              <td className="num px-2 py-1.5">{vote.judge ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--c-text-mute)]">
                {vote.model ?? "—"}
              </td>
              <td className="px-2 py-1.5">
                <span className={include ? "text-[var(--c-ok)]" : "text-[var(--c-danger)]"}>
                  {include ? "include" : "exclude"}
                </span>
              </td>
              <td className="num px-2 py-1.5 text-right">{vote.score ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--c-text-mute)]">
                {(vote.flags ?? []).join(", ") || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ContentDetail({
  eventId,
  onChanged,
}: {
  eventId: string;
  onChanged?: () => void;
}) {
  const { notify, refreshOverview } = useShell();
  const canDecide = useCan("decide");
  const resource = useResource((signal) => contentApi.read(eventId, signal), [eventId]);

  const [pending, setPending] = useState<DecisionAction | null>(null);
  const [importance, setImportance] = useState("50");
  const [busy, setBusy] = useState(false);

  if (resource.error) {
    return (
      <ErrorState
        title="条目详情加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  if (!resource.data) return <TableSkeleton rows={9} columns={2} />;

  const event = resource.data.event;
  const review = event.editorialReview;
  const spec = pending ? SPECS[pending] : null;

  const submit = async (reason: string) => {
    if (!pending) return;
    const payload: DecisionPayload = { action: pending, reason };
    if (pending === "importance") payload.importance = Number(importance) || 0;
    setBusy(true);
    try {
      await contentApi.decide(event.id, payload);
      notify("ok", `已${SPECS[pending].title}，并写入审计记录`);
      await resource.refresh();
      refreshOverview();
      onChanged?.();
      setPending(null);
    } catch (error) {
      // Keep the dialog open so the typed reason is not lost.
      notify("danger", error instanceof ApiError ? `处置失败：${error.code}` : "处置失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={event.editorialStatus ?? "legacy"} />
          <span className="text-[10px] text-[var(--c-text-mute)]">{originLabel(event.origin)}</span>
          {event.slug ? (
            <a
              href={`/e/${event.slug}.html`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-[var(--c-info)] hover:underline"
            >
              /e/{event.slug}.html ↗
            </a>
          ) : (
            <span className="font-mono text-[10px] text-[var(--c-warn)]">无 slug，无引用页</span>
          )}
        </div>
        <h3 className="mt-1.5 text-[15px] leading-6 text-[var(--c-text)]">{event.title}</h3>
        {event.titleEn && (
          <p className="mt-0.5 text-[11px] italic leading-5 text-[var(--c-text-mute)]">
            {event.titleEn}
          </p>
        )}
      </div>

      {canDecide && (
        <div className="flex flex-wrap gap-1.5 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2.5 py-2">
          {ACTIONS.map((action) => (
            <Button
              key={action}
              tone={SPECS[action].tone === "primary" ? "primary" : SPECS[action].tone === "danger" ? "danger" : "default"}
              onClick={() => {
                if (action === "importance") setImportance(String(event.importance));
                setPending(action);
              }}
            >
              {SPECS[action].title}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2.5 sm:grid-cols-4">
        <Meta label="分类" value={event.category || "—"} />
        <Meta label="置信 / 来源" value={`${event.confidence} / ${event.sourceCount}`} />
        <Meta label="重要度" value={String(event.importance)} />
        <Meta label="事件日期" value={event.sortDate} />
        <Meta label="年份" value={String(event.year)} />
        <Meta label="首次发现" value={stamp(event.firstSeenAt)} />
        <Meta label="最后更新" value={relativeTime(event.updatedAt)} />
        <Meta label="指纹" value={event.fingerprint.slice(0, 12)} />
      </div>

      {event.summary && (
        <Card title="摘要">
          <p className="text-[12px] leading-6 text-[var(--c-text-dim)]">{event.summary}</p>
        </Card>
      )}

      <Card
        title="证据来源"
        action={<span className="num text-[10px] text-[var(--c-text-mute)]">{event.sources.length} 条</span>}
      >
        {event.sources.length === 0 ? (
          <p className="text-[11px] text-[var(--c-warn)]">
            没有来源记录，这条无法自证被引用。可在「来源健康」核对对应 feed 是否停更。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {event.sources.map((source, index) => (
              <li key={`${source.url ?? index}`} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                <span className="rounded-full border border-[var(--c-line)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--c-text-mute)]">
                  {source.family || source.name || "source"}
                </span>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-[var(--c-text-dim)] hover:text-[var(--c-info)]"
                    title={source.title || source.url}
                  >
                    {source.title || source.name || source.url}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[var(--c-text-dim)]">
                    {source.title || source.name || "—"}
                  </span>
                )}
                <span className="num text-[10px] text-[var(--c-text-mute)]">
                  {source.publishedAt ? stamp(source.publishedAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="评审记录">
        {review ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Meta label="判定" value={review.decision ?? "—"} />
              <Meta label="分数" value={review.score == null ? "—" : String(review.score)} />
              <Meta
                label="赞成票"
                value={`${review.includeVotes ?? "—"} / ${review.validVotes ?? "—"}`}
              />
              <Meta label="面板版本" value={review.version ?? "—"} />
            </div>
            <p className="text-[10px] text-[var(--c-text-mute)]">
              来源 {review.source ?? "—"} · {stamp(review.at)}
              {review.reason ? ` · ${review.reason}` : ""}
            </p>
            <VoteTable review={review} />
          </div>
        ) : (
          <p className="text-[11px] text-[var(--c-text-mute)]">
            没有面板评审记录。这类条目通常是种子或人工入档，不经过自动判定。
          </p>
        )}
      </Card>

      {event.opsNote && (
        <Card title="内部按语">
          <p className="whitespace-pre-wrap text-[12px] leading-6 text-[var(--c-text-dim)]">
            {event.opsNote}
          </p>
        </Card>
      )}

      <Card
        title="处置历史"
        action={<span className="num text-[10px] text-[var(--c-text-mute)]">{event.audit.length} 条</span>}
      >
        {event.audit.length === 0 ? (
          <p className="text-[11px] text-[var(--c-text-mute)]">这条还没有任何人工处置记录。</p>
        ) : (
          <ol className="space-y-1.5">
            {event.audit.map((line, index) => (
              <li key={`${line.at}-${index}`} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                <span className="num text-[10px] text-[var(--c-text-mute)]">{stamp(line.at)}</span>
                <span className="font-mono text-[10px] text-[var(--c-info)]">{line.action}</span>
                <span className="text-[var(--c-text-dim)]">
                  {line.actor}（{line.role}）
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--c-text-mute)]" title={line.summary}>
                  {line.summary || "—"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={spec ? `${spec.title} · ${event.title.slice(0, 24)}` : ""}
        detail={spec?.detail}
        confirmLabel={spec?.confirm}
        tone={spec?.tone ?? "primary"}
        reasonLabel={spec?.reasonLabel}
        busy={busy}
        extra={
          spec?.needsImportance ? (
            <Field label="新的重要度（0–100）" hint="只影响排序与首页取数，不改变收录状态。">
              <TextInput
                value={importance}
                onChange={(value) => setImportance(value.replace(/[^\d]/g, "").slice(0, 3))}
              />
            </Field>
          ) : undefined
        }
        onCancel={() => (busy ? undefined : setPending(null))}
        onConfirm={(reason) => void submit(reason)}
      />
    </div>
  );
}
