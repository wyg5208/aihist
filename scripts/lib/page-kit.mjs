/**
 * Shared helpers for the build-time static pages. Kept in plain ESM so both
 * the generator and the checker use the exact same escaping and formatting.
 */
export const CATEGORY_LABELS = {
  milestone: "里程碑",
  model: "模型发布",
  research: "研究突破",
  opinion: "观点·访谈",
  policy: "产业·政策",
};

export const FAMILY_LABELS = {
  official: "官方公告",
  openrouter: "模型目录",
  huggingface: "开源模型库",
  arxiv: "论文预印本",
  paper: "原始论文",
  community: "社区讨论",
  media: "媒体报道",
  reference: "参考资料",
};

const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

/** Escape for a JSON block inside <script>: no raw markup or line separators. */
export function escapeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function formatFullDate(date, precision) {
  if (!date) return "日期不详";
  const [year, month, day] = String(date).split("-");
  if (precision === "year") return `${year} 年`;
  if (precision === "month") return `${year} 年 ${Number(month)} 月`;
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

export function truncate(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url);
  }
}

export function isHttpUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Flat file path: the host disables directory indexes, so no trailing slash. */
export function pagePath(slug) {
  return `/e/${slug}.html`;
}

export function absolutePageUrl(origin, slug) {
  return `${origin}${pagePath(slug)}`;
}

export function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function staticCitation({ title, eventDate, url, accessDate }) {
  return `${title}[EB/OL]. AI 纪年, ${eventDate}. ${url}（访问日期：${accessDate}）.`;
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

export function familyLabel(family) {
  return FAMILY_LABELS[family] || family;
}
