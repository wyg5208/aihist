import type { Category, Confidence, DatePrecision } from "../types";

export const CATEGORY_ORDER: Category[] = [
  "milestone",
  "model",
  "research",
  "opinion",
  "policy",
];

export const CATEGORY_META: Record<
  Category,
  { label: string; mark: string; short: string }
> = {
  milestone: { label: "里程碑", mark: "■", short: "里程碑" },
  model: { label: "模型发布", mark: "◆", short: "模型" },
  research: { label: "研究突破", mark: "●", short: "研究" },
  opinion: { label: "观点·访谈", mark: "▲", short: "观点" },
  policy: { label: "产业·政策", mark: "□", short: "政策" },
};

export const CONFIDENCE_META: Record<
  Confidence,
  { label: string; hint: string }
> = {
  verified: {
    label: "已证实",
    hint: "至少两个独立来源类别指向同一事件",
  },
  likely: {
    label: "高可信",
    hint: "单一权威一手来源，或重要度较高的一手记录",
  },
  single: {
    label: "单一来源",
    hint: "目前只有一个来源，请结合证据链接自行判断",
  },
};

export const FAMILY_LABELS: Record<string, string> = {
  official: "官方公告",
  policy: "监管原文",
  openrouter: "模型目录",
  huggingface: "开源模型库",
  arxiv: "论文预印本",
  paper: "原始论文",
  community: "社区讨论",
  media: "媒体报道",
  reference: "参考资料",
};

export const SOURCE_KEYS: Record<string, string> = {
  openrouter: "OpenRouter",
  "hf-trending": "Hugging Face 趋势",
  "hf-textgen": "Hugging Face 文本生成",
  arxiv: "arXiv",
  "hn-llm": "Hacker News · LLM",
  "hn-ai": "Hacker News · AI",
  openai: "OpenAI News",
  google: "Google AI Blog",
  anthropic: "Anthropic News",
  "hf-blog": "Hugging Face Blog",
  techcrunch: "TechCrunch AI",
  verge: "The Verge AI",
  mittr: "MIT Technology Review",
};

export function sourceLabel(key: string) {
  return SOURCE_KEYS[key] || key;
}

export function familyLabel(family: string) {
  return FAMILY_LABELS[family] || family;
}

export function summaryKindLabel(kind: string) {
  if (kind === "curated") return "人工校订";
  if (kind === "generated") return "模型生成";
  if (kind === "card") return "厂商模型卡";
  if (kind === "excerpt") return "来源摘录";
  return "自动汇总";
}

export function articleCategoryLabel(category: Category) {
  return CATEGORY_META[category]?.label || category;
}

export function formatRowDate(date: string, precision: DatePrecision) {
  if (!date) return "—";
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month") return date.slice(0, 7).replace("-", ".");
  return date.slice(0, 10).replace(/-/g, ".");
}

/**
 * The same date, but only as much of it as the precision actually supports:
 * a year-precision entry printing `1912-01-01` claims a day that nobody knows.
 */
export function shortDate(date: string, precision: DatePrecision) {
  if (!date) return "—";
  if (precision === "day") return date.slice(5, 10);
  if (precision === "month") return date.slice(0, 7);
  return date.slice(0, 4);
}

/** The editorial column stacks a bold day over its year. */
export function splitDate(date: string, precision: DatePrecision) {
  if (!date) return { main: "—", year: "" };
  if (precision === "day") return { main: date.slice(5, 10), year: date.slice(0, 4) };
  if (precision === "month") return { main: date.slice(5, 7), year: date.slice(0, 4) };
  return { main: date.slice(0, 4), year: "" };
}

export function formatFullDate(date: string, precision: DatePrecision) {
  if (!date) return "日期不详";
  const [year, month, day] = date.split("-");
  if (precision === "year") return `${year} 年`;
  if (precision === "month") return `${year} 年 ${Number(month)} 月`;
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "从未";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} 天前`;
  return formatTimestamp(value);
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatContext(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1_000_000) {
    const millions = number / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M tokens`;
  }
  if (number >= 1_000) return `${Math.round(number / 1_000)}K tokens`;
  return `${number} tokens`;
}

export function formatModality(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return value.replace(/->/g, " → ");
}

export function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function staleLabel(lastSuccessAt: string | null, stale: boolean) {
  if (!lastSuccessAt) return "档案待建立";
  return stale ? `上次同步 ${relativeTime(lastSuccessAt)}` : `${relativeTime(lastSuccessAt)}更新`;
}
