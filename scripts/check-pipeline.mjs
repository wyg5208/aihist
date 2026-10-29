/**
 * Offline regression check: run the real pipeline twice against recorded
 * upstream payloads and an in-memory database.
 *
 *   node scripts/check-pipeline.mjs
 */
import { MAX_RAW_ITEMS, runSync } from "../functions/lib/pipeline.mjs";
import { SEED_EVENTS, SEED_STAMP } from "../functions/lib/seed.mjs";
import { seriesFor, vendorFor } from "../functions/lib/taxonomy.mjs";
import { fixtureFetch } from "../dev/fixture-fetch.mjs";
import { createFakeSupabase } from "../dev/fake-supabase.mjs";

function report(label, value) {
  console.log(`${label.padEnd(24)} ${value}`);
}

function check(label, condition, detail = "") {
  if (!condition) {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const supabase = createFakeSupabase();

// This check isolates parsing, clustering and idempotency from the editorial
// panel. scripts/check-editorial.mjs covers the gate itself.
const first = await runSync({
  supabase,
  trigger: "manual",
  fetchImpl: fixtureFetch,
  editorial: false,
});
report("status", first.status);
report("result", JSON.stringify(first.result));

check("first run not busy", first.ok && !first.busy);
check("first run produced events", first.result?.createdCount > 0);
check(
  "seed version stored",
  supabase.tables.sync_state[0]?.seed_version === SEED_STAMP,
  String(supabase.tables.sync_state[0]?.seed_version)
);

const afterFirst = supabase.tables.events.length;
check(
  "event count = seeds + created",
  afterFirst === (first.result?.seedInserted || 0) + (first.result?.createdCount || 0),
  `${afterFirst} rows`
);

const fingerprints = new Set(supabase.tables.events.map((row) => row.fingerprint));
check(
  "fingerprints unique",
  fingerprints.size === supabase.tables.events.length,
  `${fingerprints.size}/${supabase.tables.events.length}`
);

const slugs = new Set(supabase.tables.events.map((row) => row.slug));
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
check(
  "every row has a stable slug",
  supabase.tables.events.every(
    (row) => typeof row.slug === "string" && slugPattern.test(row.slug)
  ),
  `${supabase.tables.events.filter((row) => !row.slug).length} missing`
);
check(
  "slugs are unique",
  slugs.size === supabase.tables.events.length,
  `${slugs.size}/${supabase.tables.events.length}`
);

const curatedSlugs = new Set(SEED_EVENTS.map((event) => event.seedId));
const seedRows = supabase.tables.events.filter((row) => row.origin === "seed");
check(
  "seed rows use curated slugs",
  seedRows.every((row) => curatedSlugs.has(row.slug)),
  `${seedRows.filter((row) => !curatedSlugs.has(row.slug)).length} drifted`
);

const categories = {};
const confidence = {};
const families = {};
for (const row of supabase.tables.events) {
  categories[row.category] = (categories[row.category] || 0) + 1;
  confidence[row.confidence] = (confidence[row.confidence] || 0) + 1;
  for (const source of row.sources || []) {
    families[source.family] = (families[source.family] || 0) + 1;
  }
}
report("categories", JSON.stringify(categories));
report("confidence", JSON.stringify(confidence));
report("source families", JSON.stringify(families));

check(
  "all rows have a summary",
  supabase.tables.events.every((row) => typeof row.summary === "string" && row.summary.length > 0)
);
check(
  "all rows have evidence",
  supabase.tables.events.every((row) => Array.isArray(row.sources) && row.sources.length > 0)
);
check(
  "cross-validated rows exist",
  supabase.tables.events.some((row) => row.confidence === "verified"),
  `${confidence.verified || 0} verified`
);
check(
  "2026 rows present",
  supabase.tables.events.some((row) => row.year === 2026)
);

const rawAfterFirst = supabase.tables.raw_items.length;
check("raw items capped", rawAfterFirst > 0 && rawAfterFirst <= MAX_RAW_ITEMS, String(rawAfterFirst));

const domesticRows = supabase.tables.events.filter((row) =>
  (row.tags || []).includes("国内")
);
report("domestic rows", String(domesticRows.length));
check(
  "domestic media rows present",
  supabase.tables.events.some((row) =>
    (row.sources || []).some((source) =>
      ["量子位", "InfoQ 中国", "钛媒体", "雷峰网"].includes(source.name)
    )
  )
);

const keywordless = supabase.tables.events.filter(
  (row) => !Array.isArray(row.tags) || row.tags.length < 2
);
check("every row has 2+ keywords", keywordless.length === 0, `${keywordless.length} short`);
const slugTags = new Set([
  "openrouter",
  "huggingface",
  "arxiv",
  "hacker-news",
  "openai",
  "anthropic",
  "policy",
  "safety",
  "agents",
  "reasoning",
  "multimodal",
  "robotics",
  "media",
  "official",
  "community",
]);
const slugLeaks = supabase.tables.events.filter((row) =>
  (row.tags || []).some((tag) => slugTags.has(tag))
);
check("no raw source slugs in keywords", slugLeaks.length === 0, `${slugLeaks.length} rows`);
report(
  "keyword sample",
  JSON.stringify(
    supabase.tables.events
      .filter((row) => row.year === 2026)
      .slice(-4)
      .map((row) => `${row.title.slice(0, 14)} → ${row.tags.join("/")}`)
  )
);

const taxonomyOfRow = (row) => ({
  vendor: vendorFor({
    category: row.category,
    organization: row.organization,
    modelName: row.model_name,
    title: row.title,
    titleEn: row.title_en,
    tags: row.tags,
  }),
  series: seriesFor({
    category: row.category,
    organization: row.organization,
    modelName: row.model_name,
    title: row.title,
    titleEn: row.title_en,
    tags: row.tags,
  }),
});
const taxonomyCase = (needle, vendor, series) => {
  const row = supabase.tables.events.find((event) => event.title.includes(needle));
  if (!row) return check(`taxonomy ${needle}`, false, "row missing");
  const got = taxonomyOfRow(row);
  check(
    `taxonomy ${needle}`,
    got.vendor === vendor && got.series === series,
    `${got.vendor}/${got.series}`
  );
};
taxonomyCase("Qwen3", "阿里云", "Qwen");
taxonomyCase("GLM-5", "智谱", "GLM");
taxonomyCase("Claude", "Anthropic", "Claude");
taxonomyCase("GPT-5", "OpenAI", "GPT");
taxonomyCase("DeepSeek-V3", "DeepSeek", "DeepSeek");

const taxonomyCoverage = supabase.tables.events.filter((row) => row.category === "model");
const withVendor = taxonomyCoverage.filter((row) => taxonomyOfRow(row).vendor).length;
const withSeries = taxonomyCoverage.filter((row) => taxonomyOfRow(row).series).length;
report("model vendor coverage", `${withVendor}/${taxonomyCoverage.length}`);
report("model series coverage", `${withSeries}/${taxonomyCoverage.length}`);
check(
  "model rows have vendor + series labels",
  withVendor === taxonomyCoverage.length && withSeries === taxonomyCoverage.length
);

const seeded = new Set(SEED_EVENTS.map((event) => event.seedId));
check("seed catalogue present", seeded.size === SEED_EVENTS.length, `${seeded.size} seeds`);

const earlySeeds = SEED_EVENTS.filter((event) => event.year <= 1990);
check(
  "pre-1991 history is covered",
  earlySeeds.length >= 28 && earlySeeds.some((event) => event.year < 1950),
  `${earlySeeds.length} seeds`
);

const zhipuSeeds = SEED_EVENTS.filter(
  (event) =>
    vendorFor({
      category: event.category,
      organization: event.organization,
      modelName: event.modelName,
      title: event.title,
      titleEn: event.titleEn,
      tags: event.tags,
    }) === "智谱"
);
const glmSeeds = zhipuSeeds.filter(
  (event) =>
    seriesFor({
      category: event.category,
      organization: event.organization,
      modelName: event.modelName,
      title: event.title,
      titleEn: event.titleEn,
      tags: event.tags,
    }) === "GLM"
);
report("Zhipu seed coverage", `${zhipuSeeds.length} seeds / ${glmSeeds.length} GLM`);
check("Zhipu seeds reach a usable depth", zhipuSeeds.length >= 10 && glmSeeds.length >= 10);

// A single run writes at most 50 non-seed events, so a large first batch may
// need a couple of passes. Once drained, further runs must add nothing.
const runs = [];
while (runs.length < 4) {
  const next = await runSync({
    supabase,
    trigger: "manual",
    fetchImpl: fixtureFetch,
    editorial: false,
  });
  runs.push(next);
  report(`run ${runs.length + 1} result`, JSON.stringify(next.result));
  if (next.result?.createdCount === 0) break;
}
const stable = runs[runs.length - 1];
const stableCount = supabase.tables.events.length;

check("pipeline drains to zero new events", stable.result?.createdCount === 0);
check("drained runs re-seed nothing", stable.result?.seedInserted === 0);
check(
  "event count stable after drain",
  supabase.tables.events.length === stableCount,
  `${stableCount} rows`
);

const rawCountAfterDrain = supabase.tables.raw_items.length;
check(
  "raw items deduplicated across runs",
  rawCountAfterDrain === rawAfterFirst,
  `${rawCountAfterDrain} rows`
);
check(
  "raw items remain capped",
  rawCountAfterDrain <= MAX_RAW_ITEMS,
  `${rawCountAfterDrain} rows`
);

const curated = supabase.tables.events.filter((row) => row.origin === "seed");
check(
  "seed rows keep curated summaries",
  curated.every((row) => row.summary_kind === "curated"),
  `${curated.length} curated rows`
);

const merged = supabase.tables.events.filter(
  (row) => row.origin === "seed" && (row.sources || []).length > 1
);
report("seeds with merged evidence", String(merged.length));

const slugless = supabase.tables.events.find((row) => row.origin !== "seed");
slugless.slug = null;
const repaired = await runSync({
  supabase,
  trigger: "manual",
  fetchImpl: fixtureFetch,
  editorial: false,
});
check(
  "backfill restores a missing slug",
  typeof slugless.slug === "string" && slugPattern.test(slugless.slug),
  slugless.slug || "missing"
);
check(
  "backfill is reported in run notes",
  String(repaired.result?.notes || "").includes("slug:1"),
  String(repaired.result?.notes)
);

console.log(
  process.exitCode ? "\nPipeline check failed." : "\nPipeline check passed."
);
