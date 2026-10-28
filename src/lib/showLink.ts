const PARAM = "show";

/**
 * 放映地址。
 *
 * 分享出去的是「看哪一段」，不是「第几屏」：`?show=2023-01..2026-04` 打开后
 * 停在设定页，进度条从第一条开始。用 `replaceState` 而不是 push，免得一次
 * 放映给浏览器留几十条历史记录。
 */
export function readShowQuery(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PARAM);
}

export function writeShowQuery(value: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(PARAM, value);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
