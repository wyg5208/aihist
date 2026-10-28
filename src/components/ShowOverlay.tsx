import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineItem } from "../types";
import {
  MONTH_LABELS,
  durationLabel,
  monthSerial,
  rangeLabel,
  type RangePreset,
  type YearMonth,
} from "../lib/period";
import { prefetchEvent } from "../hooks/useEventDetail";
import type { ShowController, ShowOptions, ShowPace } from "../hooks/useShow";
import { CATEGORY_META } from "../lib/format";
import { plateSpec } from "../lib/plate";
import { ShowSlide } from "./ShowSlide";
import { VisualPlate } from "./VisualPlate";

interface Props {
  show: ShowController;
  onOpenEntry: (item: TimelineItem) => void;
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "all", label: "全程" },
  { key: "year", label: "最近一年" },
  { key: "three", label: "最近三年" },
  { key: "since2020", label: "2020 年以来" },
];

const PACES: ShowPace[] = [6, 8, 12];

/**
 * 放映厅。
 *
 * 用原生 `<dialog>` 装：焦点陷阱、Esc 关闭、背景 inert 都由浏览器负责，
 * 不用自己写一套。里面只有两种画面——「选区间」和「一屏一条」——翻页、
 * 暂停、全屏、分享链接都在这一层收口，三套版式因此都不用改动。
 */
export function ShowOverlay({ show, onOpenEntry }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const open = show.phase !== "closed";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (show.phase !== "stage") return;
    playRef.current?.focus({ preventScroll: true });
  }, [show.phase]);

  // 下一屏的摘要提前取，翻页时右边不会先空一行再填字。
  useEffect(() => {
    if (show.phase !== "stage") return;
    if (show.active) prefetchEvent(show.active.id);
    if (show.upcoming) prefetchEvent(show.upcoming.id);
  }, [show.phase, show.active, show.upcoming]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await dialogRef.current?.requestFullscreen();
    } catch {
      // 浏览器或宿主 iframe 拒绝全屏时，放映本身照常可以用。
    }
  }, []);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    show.close();
  }, [show]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (show.phase !== "stage") return;
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      show.next();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      show.prev();
    } else if (event.key === " ") {
      event.preventDefault();
      show.togglePlay();
    } else if (event.key === "Home") {
      event.preventDefault();
      show.goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      show.goTo(show.count - 1);
    } else if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      void toggleFullscreen();
    }
  };

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const percent = show.count ? ((show.index + 1) / show.count) * 100 : 0;

  return (
    <dialog
      ref={dialogRef}
      className="show-dialog"
      aria-labelledby="show-title"
      onClose={show.close}
      onKeyDown={onKeyDown}
    >
      <div className="show-shell">
        {show.phase === "setup" ? (
          <SetupScreen show={show} onClose={close} />
        ) : (
          <>
            <header className="show-head">
              <span className="show-brand">AI 纪年 · 自动演示</span>
              <span className="show-range">{rangeLabel(show.range, show.bounds)}</span>
              <span className="show-counter">
                {show.count ? String(show.index + 1).padStart(2, "0") : "00"} / {show.count}
              </span>
              <button type="button" className="show-close" onClick={close} aria-label="退出演示">
                Esc 退出
              </button>
            </header>

            <div className="show-track" aria-hidden="true">
              <span className="show-track-fill" style={{ width: `${percent}%` }} />
              {show.playing && show.count > 1 ? (
                <span
                  key={`${show.index}-${show.options.pace}`}
                  className="show-track-tick"
                  style={{ animationDuration: `${show.options.pace}s` }}
                />
              ) : null}
            </div>

            <div
              className="show-stage"
              onPointerDown={(event) => {
                if (event.pointerType !== "touch") return;
                swipe.current = { x: event.clientX, y: event.clientY };
              }}
              onPointerUp={(event) => {
                const start = swipe.current;
                swipe.current = null;
                if (!start) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
                if (dx < 0) show.next();
                else show.prev();
              }}
            >
              {show.active ? (
                <ShowSlide key={show.active.id} item={show.active} onOpen={onOpenEntry} />
              ) : (
                <div className="show-empty">
                  <h2 id="show-title" className="show-empty-title">
                    这一段还没有记录
                  </h2>
                  <p>换一段区间，或者先把区间放到「全程」。</p>
                  <button type="button" className="show-start" onClick={show.close}>
                    回到档案
                  </button>
                </div>
              )}
            </div>

            <footer className="show-bar">
              <div className="show-controls">
                <button type="button" onClick={show.prev} aria-label="上一条" title="上一条（←）">
                  ‹
                </button>
                <button
                  ref={playRef}
                  type="button"
                  className="is-primary"
                  onClick={show.togglePlay}
                  aria-label={show.playing ? "暂停演示" : "继续演示"}
                  title={show.playing ? "暂停（空格）" : "播放（空格）"}
                >
                  {show.playing ? "❚❚" : "▶"}
                </button>
                <button type="button" onClick={show.next} aria-label="下一条" title="下一条（→）">
                  ›
                </button>
              </div>

              <div className="show-meta">
                <span className="show-state">{show.playing ? "播放中" : "已暂停"}</span>
                <span className="show-dot">·</span>
                <span>{show.options.order === "chrono" ? "旧 → 新" : "新 → 旧"}</span>
                <span className="show-dot">·</span>
                <span>{show.options.loop ? "循环" : "播完停"}</span>
                <span className="show-keys">← → 翻页 · 空格暂停 · F 全屏 · Esc 退出</span>
              </div>

              <div className="show-tools">
                <label className="show-pace">
                  <span>节奏</span>
                  <select
                    value={show.options.pace}
                    onChange={(event) => show.setPace(Number(event.target.value) as ShowPace)}
                    aria-label="每屏停留秒数"
                  >
                    {PACES.map((pace) => (
                      <option key={pace} value={pace}>
                        {pace} 秒
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => void toggleFullscreen()}>
                  {fullscreen ? "退出全屏" : "全屏"}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}

function SetupScreen({ show, onClose }: { show: ShowController; onClose: () => void }) {
  const bounds = show.bounds;
  const from: YearMonth =
    show.range.kind === "period" ? show.range.from : (bounds?.first ?? { year: 1912, month: 1 });
  const to: YearMonth =
    show.range.kind === "period" ? show.range.to : (bounds?.last ?? { year: 2026, month: 12 });
  const minYear = bounds?.first.year ?? 1912;
  const maxYear = bounds?.last.year ?? new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index),
    [minYear, maxYear]
  );
  const options: ShowOptions = show.options;
  const preview = show.queue[0] ?? null;

  const setBound = (edge: "from" | "to", value: YearMonth) => {
    if (edge === "from") show.applyCustom(value, to);
    else show.applyCustom(from, value);
  };

  return (
    <div className="show-setup">
      <header className="show-setup-head">
        <div>
          <p className="show-brand">AI 纪年 · 自动演示</p>
          <h2 id="show-title" className="show-setup-title">
            一屏一条，按编年顺序放映
          </h2>
          <p className="show-setup-lead">
            选一段区间，从 1912 一路播到现在。每屏一条记录，方向键翻页，空格暂停；
            地址栏里的链接可以直接发给别人，对方打开就是同一段故事。
          </p>
        </div>
        <button type="button" className="show-close" onClick={onClose} aria-label="关闭演示设定">
          Esc
        </button>
      </header>

      <div className="show-setup-body">
        <div className="show-setup-form">
          <fieldset className="show-field">
            <legend>区间</legend>
            <div className="show-presets" role="group" aria-label="快捷区间">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={show.preset === preset.key}
                  onClick={() => show.applyPreset(preset.key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="show-bounds">
              <MonthField
                label="起始"
                value={from}
                years={years}
                onChange={(value) => setBound("from", value)}
              />
              <span className="show-dash" aria-hidden="true">
                —
              </span>
              <MonthField
                label="结束"
                value={to}
                years={years}
                onChange={(value) => setBound("to", value)}
              />
            </div>
            <p className="show-hint">
              {show.preset === "custom" ? "自定义区间 · " : ""}
              {monthSerial(from) > monthSerial(to) ? "起止已自动对调 · " : ""}
              {show.count
                ? `${show.count} 条记录 · 按 ${options.pace} 秒一屏约需 ${durationLabel(
                    show.count,
                    options.pace
                  )}`
                : "该区间没有记录 · 换一段区间或选「全程」"}
            </p>
          </fieldset>

          <div className="show-field-row">
            <fieldset className="show-field">
              <legend>节奏</legend>
              <div className="show-segment" role="group" aria-label="每屏停留秒数">
                {PACES.map((pace) => (
                  <button
                    key={pace}
                    type="button"
                    aria-pressed={options.pace === pace}
                    onClick={() => show.setPace(pace)}
                  >
                    {pace} 秒
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="show-field">
              <legend>顺序</legend>
              <div className="show-segment" role="group" aria-label="播放顺序">
                <button
                  type="button"
                  aria-pressed={options.order === "chrono"}
                  onClick={() => show.setOrder("chrono")}
                >
                  旧 → 新
                </button>
                <button
                  type="button"
                  aria-pressed={options.order === "reverse"}
                  onClick={() => show.setOrder("reverse")}
                >
                  新 → 旧
                </button>
              </div>
            </fieldset>

            <fieldset className="show-field">
              <legend>收尾</legend>
              <div className="show-segment" role="group" aria-label="播完是否循环">
                <button type="button" aria-pressed={options.loop} onClick={show.toggleLoop}>
                  {options.loop ? "循环播放" : "播完停住"}
                </button>
              </div>
            </fieldset>
          </div>

          <div className="show-setup-actions">
            <button type="button" className="show-start" onClick={show.start} disabled={!show.count}>
              {show.count ? "开始放映" : "该区间没有记录"}
            </button>
            <button type="button" className="show-cancel" onClick={onClose}>
              取消
            </button>
          </div>

          <p className="show-note">
            登记过图片的条目用登记图（含 AI 生成示意图，图注写明并非史实照片）；其余用程序化「编年图版」，图案由年份、类别与标签确定，不描摹史实。出处、授权与类型都登记在 <code>src/data/visuals.json</code>。
          </p>
        </div>

        <aside className="show-setup-preview" aria-label="节目单预览">
          <p className="show-preview-label">节目单 · 从这一屏开始</p>
          <div className="show-preview-frame">
            {preview ? (
              <VisualPlate spec={plateSpec(preview)} />
            ) : (
              <span className="show-preview-empty">该区间没有记录</span>
            )}
          </div>
          <p className="show-preview-title">{preview?.title ?? "—"}</p>
          <p className="show-preview-meta">
            {preview
              ? `${preview.year} · ${CATEGORY_META[preview.category].label} · ${
                  preview.organization || "机构未录"
                }`
              : "换一段区间再试"}
          </p>
          <dl className="show-preview-stats">
            <div>
              <dt>条目</dt>
              <dd>{show.count}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>{durationLabel(show.count, options.pace)}</dd>
            </div>
            <div>
              <dt>顺序</dt>
              <dd>{options.order === "chrono" ? "旧 → 新" : "新 → 旧"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function MonthField({
  label,
  value,
  years,
  onChange,
}: {
  label: string;
  value: YearMonth;
  years: number[];
  onChange: (value: YearMonth) => void;
}) {
  return (
    <div className="show-month-field">
      <span className="show-month-label">{label}</span>
      <span className="show-selects">
        <select
          aria-label={`${label}年份`}
          value={value.year}
          onChange={(event) => onChange({ ...value, year: Number(event.target.value) })}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label}月份`}
          value={value.month}
          onChange={(event) => onChange({ ...value, month: Number(event.target.value) })}
        >
          {MONTH_LABELS.map((month, index) => (
            <option key={month} value={index + 1}>
              {month}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
