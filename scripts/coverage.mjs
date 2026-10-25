import { modelKeyOf, titleTokens } from "../functions/lib/normalize.mjs";
import { SEED_EVENTS } from "../functions/lib/seed.mjs";
import { BENCHMARK } from "./benchmark.mjs";

export const DEFAULT_THRESHOLDS = {
  total: 0.85,
  decade: 0.7,
  vendor: 0.6,
  minDimensionSize: 5,
  highSeedImportance: 85,
};

const CATEGORIES = new Set([
  "milestone",
  "model",
  "research",
  "opinion",
  "policy",
]);

function textOf(row) {
  return [row.title, row.title_en, row.titleEn, row.model_name, row.modelName]
    .filter(Boolean)
    .join(" ");
}

function keysOf(row) {
  const meta = row.meta || {};
  const values = [
    meta.modelKey,
    row.modelKey,
    ...(meta.aliases || []),
    ...(row.aliases || []),
  ].filter(Boolean);
  return new Set(values.map(modelKeyOf).filter(Boolean));
}

function rowId(row, index) {
  return row.id || row.fingerprint || row.seedId || `row-${index}`;
}

/**
 * A benchmark entry matches a row when it shares at least two distinctive
 * tokens, carries the same model key, or contains its unique phrase. The year
 * guard keeps a 2026 re-release from satisfying a 2024 entry.
 */
export function matchDetail(entry, row) {
  if (!row || typeof row.year !== "number") return null;
  if (Math.abs(row.year - entry.year) > 1) return null;
  const text = textOf(row).toLowerCase();

  if (entry.keys.length) {
    const rowKeys = keysOf(row);
    if (entry.keys.some((key) => rowKeys.has(modelKeyOf(key)))) {
      return { kind: "model-key", score: 400 - Math.abs(row.year - entry.year) };
    }
  }
  if (entry.phrase && text.includes(entry.phrase.toLowerCase())) {
    return { kind: "phrase", score: 300 - Math.abs(row.year - entry.year) };
  }
  const tokens = new Set(titleTokens(text));
  const shared = (entry.tokens || []).filter((token) => tokens.has(token));
  if (shared.length >= 2) {
    return {
      kind: "tokens",
      score: 200 + shared.length - Math.abs(row.year - entry.year),
      shared,
    };
  }
  return null;
}

export function validateBenchmark(entries) {
  const errors = [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) {
      errors.push(`benchmark: duplicate or empty id — ${entry.id || "(empty)"}`);
    }
    ids.add(entry.id);
    if (!CATEGORIES.has(entry.category)) {
      errors.push(`benchmark ${entry.id}: unknown category ${entry.category}`);
    }
    if (!Number.isInteger(entry.year) || entry.year < 1900 || entry.year > 2100) {
      errors.push(`benchmark ${entry.id}: invalid year ${entry.year}`);
    }
    if (!Number.isFinite(entry.importance) || entry.importance < 0 || entry.importance > 100) {
      errors.push(`benchmark ${entry.id}: invalid importance ${entry.importance}`);
    }
    if (!entry.note) errors.push(`benchmark ${entry.id}: note is required`);
    if (
      entry.tokens.length < 2 &&
      entry.keys.length === 0 &&
      entry.phrase.length < 2
    ) {
      errors.push(`benchmark ${entry.id}: no usable matcher`);
    }
  }
  return errors;
}

export function matchBenchmark(rows, benchmark = BENCHMARK) {
  const pairs = [];
  rows.forEach((row, index) => {
    for (const entry of benchmark) {
      const detail = matchDetail(entry, row);
      if (!detail) continue;
      pairs.push({
        entry,
        row,
        id: rowId(row, index),
        kind: detail.kind,
        score: detail.score,
      });
    }
  });
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.year - b.entry.year ||
      a.entry.id.localeCompare(b.entry.id)
  );

  const matched = new Map();
  const usedRows = new Set();
  for (const pair of pairs) {
    if (matched.has(pair.entry.id) || usedRows.has(pair.id)) continue;
    matched.set(pair.entry.id, {
      rowId: pair.id,
      slug: pair.row.slug || null,
      title: pair.row.title,
      kind: pair.kind,
    });
    usedRows.add(pair.id);
  }
  return matched;
}

function groupStats(entries, matched, keyOf, sort) {
  const buckets = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key === null || key === undefined) continue;
    if (!buckets.has(key)) buckets.set(key, { expected: 0, matched: 0 });
    const bucket = buckets.get(key);
    bucket.expected += 1;
    if (matched.has(entry.id)) bucket.matched += 1;
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      expected: value.expected,
      matched: value.matched,
      rate: value.expected ? value.matched / value.expected : 1,
    }))
    .sort(sort);
}

const byDecade = (a, b) => Number.parseInt(a.key, 10) - Number.parseInt(b.key, 10);
const byCount =
  (label) =>
  (a, b) =>
    b.expected - a.expected ||
    b.matched - a.matched ||
    String(a.key).localeCompare(String(b.key), label);

export function buildCoverage(
  rows,
  { benchmark = BENCHMARK, thresholds = DEFAULT_THRESHOLDS } = {}
) {
  const validationErrors = validateBenchmark(benchmark);
  const matched = matchBenchmark(rows, benchmark);
  const total = {
    expected: benchmark.length,
    matched: matched.size,
    rate: benchmark.length ? matched.size / benchmark.length : 1,
  };

  const decades = groupStats(
    benchmark,
    matched,
    (entry) => `${Math.floor(entry.year / 10) * 10}s`,
    byDecade
  );
  const vendors = groupStats(
    benchmark,
    matched,
    (entry) => entry.vendor,
    byCount("zh-CN")
  );
  const categories = groupStats(
    benchmark,
    matched,
    (entry) => entry.category,
    byCount("en")
  );

  const gaps = benchmark
    .filter((entry) => !matched.has(entry.id))
    .sort(
      (a, b) =>
        b.importance - a.importance ||
        b.year - a.year ||
        a.id.localeCompare(b.id)
    )
    .map((entry) => ({
      id: entry.id,
      year: entry.year,
      category: entry.category,
      vendor: entry.vendor,
      importance: entry.importance,
      note: entry.note,
      tokens: entry.tokens,
      keys: entry.keys,
      phrase: entry.phrase,
    }));

  const highSeeds = SEED_EVENTS.filter(
    (seed) => seed.curatedImportance >= thresholds.highSeedImportance
  );
  const highMissing = highSeeds
    .filter(
      (seed) => !benchmark.some((entry) => Boolean(matchDetail(entry, seed)))
    )
    .map((seed) => ({
      seedId: seed.seedId,
      year: seed.year,
      importance: seed.curatedImportance,
      title: seed.title,
    }));

  const errors = [...validationErrors];
  if (total.rate < thresholds.total) {
    errors.push(
      `total coverage ${(total.rate * 100).toFixed(1)}% is below ${
        (thresholds.total * 100).toFixed(1)
      }%`
    );
  }
  for (const decade of decades) {
    if (decade.expected < thresholds.minDimensionSize) continue;
    if (decade.rate < thresholds.decade) {
      errors.push(
        `${decade.key} coverage ${(decade.rate * 100).toFixed(1)}% is below ${
          (thresholds.decade * 100).toFixed(1)
        }%`
      );
    }
  }
  for (const vendor of vendors) {
    if (vendor.expected < thresholds.minDimensionSize) continue;
    if (vendor.rate < thresholds.vendor) {
      errors.push(
        `${vendor.key} coverage ${(vendor.rate * 100).toFixed(1)}% is below ${
          (thresholds.vendor * 100).toFixed(1)
        }%`
      );
    }
  }
  for (const seed of highMissing) {
    errors.push(
      `high-importance seed ${seed.seedId} (${seed.importance}) is absent from the benchmark`
    );
  }

  return {
    ok: errors.length === 0,
    total,
    decades,
    vendors,
    categories,
    gaps,
    matchedEntries: [...matched.entries()].map(([id, info]) => ({
      id,
      ...info,
    })),
    highImportanceSeeds: {
      expected: highSeeds.length,
      missing: highMissing,
    },
    thresholds,
    events: rows.length,
    benchmark: benchmark.length,
    errors,
  };
}

export function formatCoverage(report, { vendorLimit = 10, gapLimit = 20 } = {}) {
  const pct = (rate) => `${(rate * 100).toFixed(1)}%`;
  const lines = [
    `benchmark      ${report.benchmark} entries · ${report.gaps.length} gaps`,
    `archive        ${report.events} events`,
    `total          ${report.total.matched}/${report.total.expected} · ${pct(
      report.total.rate
    )}  (min ${pct(report.thresholds.total)})`,
    "",
    "by decade",
    ...report.decades.map(
      (item) =>
        `  ${item.key.padEnd(6)} ${String(item.matched).padStart(3)}/${String(
          item.expected
        ).padEnd(3)} ${pct(item.rate).padStart(6)}${
          item.expected >= report.thresholds.minDimensionSize
            ? item.rate < report.thresholds.decade
              ? "  below threshold"
              : ""
            : ""
        }`
    ),
    "",
    `by vendor (top ${vendorLimit})`,
    ...report.vendors.slice(0, vendorLimit).map(
      (item) =>
        `  ${String(item.key).padEnd(12)} ${String(item.matched).padStart(
          3
        )}/${String(item.expected).padEnd(3)} ${pct(item.rate).padStart(6)}${
          item.expected >= report.thresholds.minDimensionSize &&
          item.rate < report.thresholds.vendor
            ? "  below threshold"
            : ""
        }`
    ),
    "",
    "by category",
    ...report.categories.map(
      (item) =>
        `  ${item.key.padEnd(10)} ${String(item.matched).padStart(3)}/${String(
          item.expected
        ).padEnd(3)} ${pct(item.rate).padStart(6)}`
    ),
    "",
    `high-importance seeds in benchmark  ${
      report.highImportanceSeeds.expected -
      report.highImportanceSeeds.missing.length
    }/${report.highImportanceSeeds.expected}`,
  ];

  if (report.gaps.length) {
    lines.push("", `gaps (${report.gaps.length}, by importance)`);
    for (const gap of report.gaps.slice(0, gapLimit)) {
      lines.push(
        `  ${String(gap.importance).padStart(3)}  ${gap.id}  ${gap.year}  ${
          gap.category
        }${gap.vendor ? `  ${gap.vendor}` : ""}`
      );
      lines.push(`       ${gap.note}`);
    }
    if (report.gaps.length > gapLimit) {
      lines.push(`  … ${report.gaps.length - gapLimit} more in coverage-report.json`);
    }
  }

  return lines.join("\n");
}
