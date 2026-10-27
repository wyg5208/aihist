import type { TimelineItem } from "../types";

export interface CadenceSlot {
  key: string;
  label: string;
  count: number;
  current: boolean;
}

/**
 * Eight quarters ending with the one we are in, oldest first. Both the night
 * view's two sparklines and any future cadence readout use this, so the answer
 * to "how busy has the archive been" is computed once.
 */
export function quarterSlots(items: TimelineItem[], span = 8): CadenceSlot[] {
  const now = new Date();
  const currentIndex = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
  const slots: CadenceSlot[] = [];

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const index = currentIndex - offset;
    const year = Math.floor(index / 4);
    const quarter = (index % 4) + 1;
    slots.push({
      key: `${year}-Q${quarter}`,
      label: `${String(year).slice(2)}Q${quarter}`,
      count: 0,
      current: offset === 0,
    });
  }

  const byKey = new Map(slots.map((slot) => [slot.key, slot]));
  for (const item of items) {
    const date = item.sortDate || item.eventDate;
    if (!/^\d{4}-\d{2}/.test(date)) continue;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    const slot = byKey.get(`${year}-Q${Math.floor((month - 1) / 3) + 1}`);
    if (slot) slot.count += 1;
  }

  return slots;
}
