/**
 * Freeze the read-only API responses of the reference implementation.
 *
 *   node scripts/export-api-golden.mjs
 *
 * The output (`backend/tests/fixtures/golden/api-*.json`) is the contract the
 * Python port must reproduce key-for-key. It is produced by running the real
 * Function handler over the frozen seed inside the in-memory Supabase stand-in,
 * so no network or credentials are involved.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handleApp } from "../functions/handler.mjs";
import { createFakeSupabase } from "../dev/fake-supabase.mjs";
import { confidenceOf, fingerprintOf } from "../functions/lib/cluster.mjs";
import { CATEGORY_KEYS } from "../functions/lib/normalize.mjs";
import { SEED_EVENTS, SEED_STAMP } from "../functions/lib/seed.mjs";
import { autoSlug, seedSlug } from "../functions/lib/slug.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(root, "backend", "tests", "fixtures", "golden");

// Mirror of `functions/lib/pipeline.mjs:eventRow` with the frozen seed fields.
function eventRow(candidate, nowIso) {
  const date = candidate.eventDate || candidate.sortDate || `${candidate.year || 2025}-01-01`;
  const year = candidate.year || Number(date.slice(0, 4));
  const families = [...new Set((candidate.evidence || []).map((s) => s.family || "official"))];
  const slug =
    (candidate.origin === "seed" ? seedSlug(candidate.seedId) : "") ||
    autoSlug(year, candidate.fingerprint);
  return {
    id: crypto.randomUUID(),
    slug: slug || null,
    fingerprint: candidate.fingerprint,
    event_date: date,
    date_precision: candidate.datePrecision || (date.length === 10 ? "day" : "month"),
    sort_date: candidate.sortDate || date,
    year,
    title: candidate.title,
    title_en: candidate.titleEn || null,
    summary: candidate.summary || "",
    summary_kind: candidate.summaryKind || "excerpt",
    category: candidate.category,
    organization: candidate.organization || null,
    model_name: candidate.modelName || null,
    importance: candidate.importance,
    confidence: candidate.confidence,
    source_count: candidate.sourceCount ?? candidate.evidence?.length ?? 0,
    source_families: families,
    sources: candidate.evidence || [],
    tags: candidate.tags || [],
    meta: candidate.meta || {},
    origin: candidate.origin || "auto",
    editorial_status: candidate.origin === "seed" ? "admitted" : candidate.editorialStatus || null,
    editorial_review: candidate.editorialReview || null,
    first_seen_at: nowIso,
    updated_at: nowIso,
  };
}

async function seedRows(nowIso) {
  const seen = new Set();
  const rows = [];
  for (const candidate of SEED_EVENTS) {
    if (!CATEGORY_KEYS.includes(candidate.category)) continue;
    const importance = candidate.curatedImportance ?? 50;
    const families = [...new Set((candidate.evidence || []).map((s) => s.family || "official"))];
    const finalized = {
      ...candidate,
      importance,
      confidence: confidenceOf({ families }, importance),
      sourceCount: candidate.evidence.length,
    };
    const fingerprint = await fingerprintOf(finalized);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    rows.push(eventRow({ ...finalized, fingerprint }, nowIso));
  }
  return rows;
}

function stateRow(nowIso) {
  return {
    id: "global",
    lease_token: null,
    lease_expires_at: null,
    run_id: null,
    last_attempt_at: nowIso,
    last_success_at: nowIso,
    last_status: "succeeded",
    seed_version: SEED_STAMP,
    updated_at: nowIso,
  };
}

async function call(supabase, action, query = "") {
  const url = `http://127.0.0.1/functions/v1/app?action=${action}${query}`;
  const response = await handleApp({
    request: new Request(url, { method: "GET" }),
    supabase,
    runtime: { env: {} },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${action}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const nowIso = "2026-10-24T00:00:00.000Z";
  const events = await seedRows(nowIso);

  const supabase = createFakeSupabase({
    events,
    sync_state: [stateRow(nowIso)],
    sync_runs: [
      {
        id: crypto.randomUUID(),
        trigger: "manual",
        status: "succeeded",
        started_at: "2026-10-23T22:00:00.000Z",
        finished_at: "2026-10-23T22:01:10.000Z",
        raw_count: 180,
        created_count: 4,
        merged_count: 2,
        failed_sources: [],
        notes: null,
      },
    ],
  });

  const timeline = await call(supabase, "timeline");
  const status = await call(supabase, "status");
  const standard = await call(supabase, "standard");

  const deepest = [...events].sort((a, b) => (a.sort_date < b.sort_date ? 1 : -1))[0];
  const bySlug = await call(supabase, "event", `&slug=${encodeURIComponent(deepest.slug)}`);
  const byId = await call(supabase, "event", `&id=${deepest.id}`);

  await mkdir(outDir, { recursive: true });
  const files = {
    "api-timeline.json": timeline,
    "api-status.json": status,
    "api-standard.json": standard,
    "api-event.json": bySlug,
    "api-event-by-id.json": byId,
  };
  for (const [name, payload] of Object.entries(files)) {
    await writeFile(join(outDir, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`${name}: ${JSON.stringify(payload).length} bytes`);
  }
  console.log(`events seeded: ${events.length}`);
  console.log(`fixture slug: ${deepest.slug}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
