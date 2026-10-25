import { eventUrl } from "./permalink";

interface CitationInput {
  title: string;
  eventDate: string;
  slug: string | null;
  /** Canonical static page; falls back to the interactive ?e= address. */
  url?: string | null;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function accessDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * GB/T 7714 style, trimmed to the fields the archive can actually verify.
 * The event date keeps its original precision; no day is invented.
 */
export function citationText(input: CitationInput, now = new Date()): string {
  if (!input.slug) return "";
  const url = input.url || eventUrl(input.slug, true);
  return `${input.title}[EB/OL]. AI 纪年, ${input.eventDate}. ${url}（访问日期：${accessDate(now)}）.`;
}
