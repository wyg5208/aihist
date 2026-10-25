import { useEffect, useRef, useState } from "react";
import { fetchStandard } from "../api";
import type { PanelInfo, Standard } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  panel: PanelInfo | null;
}

export function StandardDialog({ open, onClose, panel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [standard, setStandard] = useState<Standard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || standard || loading || error) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetchStandard(controller.signal)
      .then((data) => setStandard(data.standard))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, standard, loading, error, attempt]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="standard-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="standard-dialog w-[min(58rem,calc(100vw-1.5rem))] max-h-[88vh] border border-[var(--ink)] bg-[var(--paper)] p-0 text-[var(--ink)]"
    >
      <div className="max-h-[88vh] overflow-y-auto p-5 sm:p-8">
        <div className="flex items-start justify-between gap-6 border-b border-[var(--ink)] pb-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Editorial standard · {standard?.version || "chronicle-v2"}
            </p>
            <h2 id="standard-heading" className="mt-1 font-serif text-3xl leading-tight">
              收录标准
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-[var(--rule-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors motion-safe:hover:bg-[var(--ink)] motion-safe:hover:text-[var(--paper)]"
          >
            关闭
          </button>
        </div>

        {loading && (
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]" role="status">
            正在读取标准
          </p>
        )}

        {error && (
          <div className="mt-6" role="alert">
            <p className="text-[13px] text-[var(--ink-soft)]">
              收录标准暂时无法读取，请稍后重试。
            </p>
            <button
              type="button"
              onClick={() => {
                setError(false);
                setAttempt((value) => value + 1);
              }}
              className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)] underline underline-offset-4"
            >
              重新读取
            </button>
          </div>
        )}

        {standard && (
          <>
            <p className="mt-5 max-w-3xl text-pretty text-[15px] leading-7 text-[var(--ink-soft)]">
              {standard.principle}
            </p>

            <div className="mt-4 grid gap-3 border-y border-[var(--rule)] py-4 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                  评审面板
                </p>
                <p className="mt-1 text-[13px] leading-6 text-[var(--ink-soft)]">
                  {panel?.configured
                    ? `已启用 ${panel.models.length} 个独立模型：${panel.models.join(" · ")}`
                    : "尚未配置评审模型。未经评审的自动条目一律暂缓并隐藏，只保留人工校订条目。"}
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-4 font-mono text-[10px] sm:text-right">
                <div>
                  <dt className="uppercase tracking-[0.16em] text-[var(--muted)]">入档线</dt>
                  <dd className="mt-1 font-serif text-2xl leading-none">{standard.includeScore}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.16em] text-[var(--muted)]">评审</dt>
                  <dd className="mt-1 font-serif text-2xl leading-none">
                    {panel?.configured ? panel.models.length : standard.panelSize}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.16em] text-[var(--muted)]">所需票数</dt>
                  <dd className="mt-1 font-serif text-2xl leading-none">{standard.minVotes}</dd>
                </div>
              </dl>
            </div>

            <section className="mt-7" aria-labelledby="standard-gates">
              <h3
                id="standard-gates"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]"
              >
                五道硬门槛 · 全部满足才进入评分
              </h3>
              <ol className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                {standard.gates.map((gate, index) => (
                  <li key={gate.title} className="grid grid-cols-[2rem_1fr] gap-3 py-3">
                    <span className="font-mono text-[10px] leading-5 text-[var(--accent)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="font-serif text-[15px] leading-6">{gate.title}</p>
                      <p className="mt-0.5 text-[12px] leading-5 text-[var(--ink-soft)]">
                        {gate.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="mt-7 grid gap-7 lg:grid-cols-2">
              <section aria-labelledby="standard-dimensions">
                <h3
                  id="standard-dimensions"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]"
                >
                  评分维度 · 满分 100
                </h3>
                <dl className="mt-3 space-y-2.5">
                  {standard.dimensions.map((dimension) => (
                    <div key={dimension.name} className="grid grid-cols-[1fr_2rem] gap-3">
                      <div>
                        <dt className="flex items-baseline gap-2 text-[13px] leading-5">
                          <span className="font-serif">{dimension.name}</span>
                          <span className="font-mono text-[9px] text-[var(--muted)]">
                            {dimension.weight}
                          </span>
                        </dt>
                        <dd className="text-[11.5px] leading-5 text-[var(--muted)]">
                          {dimension.detail}
                        </dd>
                      </div>
                      <div className="mt-1 h-[3px] bg-[var(--rule)]" aria-hidden="true">
                        <div
                          className="h-full bg-[var(--accent)]"
                          style={{ width: `${dimension.weight}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-labelledby="standard-decisions">
                <h3
                  id="standard-decisions"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]"
                >
                  判定规则 · 失败关闭
                </h3>
                <dl className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                  {(
                    [
                      ["include", "入档"],
                      ["exclude", "排除"],
                      ["hold", "暂缓"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="grid grid-cols-[4rem_1fr] gap-3 py-2.5">
                      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink)]">
                        {label}
                      </dt>
                      <dd className="text-[12px] leading-5 text-[var(--ink-soft)]">
                        {standard.decisions[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[11.5px] leading-5 text-[var(--muted)]">
                  {standard.panel.detail}
                </p>
              </section>
            </div>

            <section className="mt-7" aria-labelledby="standard-rejects">
              <h3
                id="standard-rejects"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]"
              >
                直接排除 · 不进入模型评审
              </h3>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {standard.hardRejects.map((rule) => (
                  <li
                    key={rule.key}
                    className="border border-[var(--rule-strong)] px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-[var(--ink-soft)]"
                  >
                    {rule.label}
                  </li>
                ))}
              </ul>
            </section>

            <p className="mt-6 border-t border-[var(--rule)] pt-3 text-[11px] leading-5 text-[var(--muted)]">
              评审只决定是否入档，不覆盖人工校订条目的标题与摘要。每轮同步最多送审 24 条，
              其余候选留待下一轮；已入档或已排除的候选在标准版本不变时复用票型，
              暂缓候选会在后续同步中重审。
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}
