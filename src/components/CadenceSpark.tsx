import type { TimelineItem } from "../types";

interface Props {
  items: TimelineItem[];
}

interface Slot {
  key: string;
  label: string;
  count: number;
  current: boolean;
}

function quarterSlots(items: TimelineItem[]): Slot[] {
  const now = new Date();
  const currentIndex = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
  const slots: Slot[] = [];

  for (let offset = 7; offset >= 0; offset -= 1) {
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
    const key = `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    const slot = byKey.get(key);
    if (slot) slot.count += 1;
  }

  return slots;
}

export function CadenceSpark({ items }: Props) {
  const slots = quarterSlots(items);
  const max = Math.max(1, ...slots.map((slot) => slot.count));
  const total = slots.reduce((sum, slot) => sum + slot.count, 0);

  const width = 248;
  const height = 74;
  const baseY = 50;
  const barWidth = 14;
  const step = (width - 16) / slots.length;

  return (
    <section className="rail-card" aria-labelledby="cadence-heading">
      <div className="rail-heading">
        <h2 id="cadence-heading">季度入档量</h2>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
          近 8 季 · {total} 条
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`近八个季度入档数量：${slots
          .map((slot) => `${slot.label} ${slot.count} 条`)
          .join("，")}`}
      >
        <line
          x1="0"
          y1={baseY + 0.5}
          x2={width}
          y2={baseY + 0.5}
          stroke="var(--rule)"
          strokeWidth="1"
        />
        {slots.map((slot, index) => {
          const barHeight =
            slot.count === 0 ? 1.5 : Math.max(3, (slot.count / max) * (baseY - 10));
          const x = 8 + index * step;
          return (
            <g key={slot.key}>
              <rect
                className="spark-bar"
                data-current={slot.current}
                x={x}
                y={baseY - barHeight}
                width={barWidth}
                height={barHeight}
              >
                <title>{`${slot.key} · ${slot.count} 条`}</title>
              </rect>
              <text
                className="spark-label"
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
              >
                {slot.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[11.5px] leading-4 text-[var(--muted)]">
        历史种子与自动采集共同计入；当前季度以朱红标记。
      </p>
    </section>
  );
}
