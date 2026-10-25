import { fail, json, readJsonBody, uuidRe } from "./lib/http.mjs";
import {
  countEvents,
  leaseIsHeld,
  queryTimeline,
  readEvent,
  readEventBySlug,
  readState,
  recentRuns,
} from "./lib/db.mjs";
import { CATEGORY_KEYS } from "./lib/normalize.mjs";
import { STANDARD, publicPanelInfo } from "./lib/editorial.mjs";
import { keywordsFor } from "./lib/keywords.mjs";
import { isSlug } from "./lib/slug.mjs";
import { seriesFor, vendorFor } from "./lib/taxonomy.mjs";
import { runSync } from "./lib/pipeline.mjs";

const FRESH_HOURS = 6;
const MANUAL_COOLDOWN_MS = 3 * 60_000;
const CONFIDENCE_KEYS = new Set(["verified", "likely", "single"]);
const KNOWN_ACTIONS = new Set(["timeline", "event", "status", "standard", "sync"]);

function asInt(value, min, max) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function timelineItem(row) {
  return {
    id: row.id,
    slug: row.slug || null,
    eventDate: row.event_date,
    datePrecision: row.date_precision,
    sortDate: row.sort_date,
    year: row.year,
    title: row.title,
    titleEn: row.title_en || null,
    category: row.category,
    organization: row.organization || null,
    modelName: row.model_name || null,
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
    importance: row.importance,
    confidence: row.confidence,
    sourceCount: row.source_count,
    sourceFamilies: Array.isArray(row.source_families) ? row.source_families : [],
    tags: keywordsFor({
      tags: row.tags,
      title: row.title,
      titleEn: row.title_en,
      summary: row.summary,
      organization: row.organization,
      modelName: row.model_name,
      category: row.category,
    }),
    origin: row.origin,
    editorialStatus: row.editorial_status || null,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

function eventDetail(row) {
  return {
    ...timelineItem(row),
    // The detail payload carries the summary, so keywords can be inferred
    // from it as well and may be richer than the list-view chips.
    tags: keywordsFor({
      tags: row.tags,
      title: row.title,
      titleEn: row.title_en,
      summary: row.summary,
      organization: row.organization,
      modelName: row.model_name,
      category: row.category,
    }),
    fingerprint: row.fingerprint,
    summary: row.summary,
    summaryKind: row.summary_kind,
    sources: Array.isArray(row.sources) ? row.sources : [],
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
    editorialStatus: row.editorial_status || null,
    editorialReview:
      row.editorial_review && typeof row.editorial_review === "object"
        ? row.editorial_review
        : null,
  };
}

function runItem(row) {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rawCount: row.raw_count ?? 0,
    createdCount: row.created_count ?? 0,
    mergedCount: row.merged_count ?? 0,
    failedSources: Array.isArray(row.failed_sources) ? row.failed_sources : [],
    notes: row.notes || null,
  };
}

function isFresh(state) {
  if (!state?.last_success_at) return false;
  const stamp = Date.parse(state.last_success_at);
  return Number.isFinite(stamp) && Date.now() - stamp < FRESH_HOURS * 3600_000;
}

function syncSummary(state) {
  return {
    lastSuccessAt: state?.last_success_at || null,
    lastAttemptAt: state?.last_attempt_at || null,
    lastStatus: state?.last_status || null,
    running: leaseIsHeld(state),
    stale: !isFresh(state),
    seedVersion: state?.seed_version || null,
  };
}

function handleError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "lease_lost" || code === "sync_failed") {
    return fail("sync_failed", 503);
  }
  if (code) {
    console.error(`[app] ${code}`);
    return fail("database_request_failed", 503);
  }
  console.error("[app] internal_error");
  return fail("internal_error", 500);
}

async function timeline({ params, supabase }) {
  const limitRaw = params.get("limit");
  const limit = limitRaw == null ? 600 : asInt(limitRaw, 1, 1200);
  if (limit == null) return fail("invalid_limit", 400);

  const category = params.get("category");
  if (category && !CATEGORY_KEYS.includes(category)) return fail("invalid_category", 400);

  const confidence = params.get("confidence");
  if (confidence && !CONFIDENCE_KEYS.has(confidence)) return fail("invalid_confidence", 400);

  const yearRaw = params.get("year");
  const year = yearRaw == null ? null : asInt(yearRaw, 1900, 2100);
  if (yearRaw != null && year == null) return fail("invalid_year", 400);

  const state = await readState(supabase);
  const { items, total } = await queryTimeline(supabase, { category, confidence, year, limit });
  return json({
    ok: true,
    items: items.map(timelineItem),
    total,
    truncated: total > items.length,
    sync: syncSummary(state),
  });
}

async function event({ params, supabase }) {
  const slug = params.get("slug");
  if (slug != null) {
    if (!isSlug(slug)) return fail("invalid_slug", 400);
    const row = await readEventBySlug(supabase, slug);
    if (!row || row.editorial_status === "excluded" || row.editorial_status === "hold") {
      return fail("not_found", 404);
    }
    return json({ ok: true, event: eventDetail(row) });
  }

  const id = params.get("id");
  if (!id || !uuidRe.test(id)) return fail("invalid_id", 400);
  const row = await readEvent(supabase, id);
  if (!row || row.editorial_status === "excluded" || row.editorial_status === "hold") {
    return fail("not_found", 404);
  }
  return json({ ok: true, event: eventDetail(row) });
}

async function status({ supabase, runtime }) {
  const [state, runs, total] = await Promise.all([
    readState(supabase),
    recentRuns(supabase, 5),
    countEvents(supabase),
  ]);
  return json({
    ok: true,
    sync: { ...syncSummary(state), eventCount: total },
    panel: publicPanelInfo(runtime?.env),
    runs: runs.map(runItem),
  });
}

function standard() {
  return json({ ok: true, standard: STANDARD });
}

async function sync({ request, supabase, runtime }) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json\b/i.test(contentType)) return fail("unsupported_media_type", 415);

  const body = await readJsonBody(request, 2048);
  if (!body.ok) {
    const statusCode = body.error === "body_too_large" ? 413 : 400;
    return fail(body.error, statusCode);
  }
  const trigger = body.value?.trigger;
  if (trigger !== "auto" && trigger !== "manual") return fail("invalid_trigger", 400);

  const state = await readState(supabase);

  if (leaseIsHeld(state)) {
    return fail("sync_busy", 409, { "retry-after": "20" });
  }

  if (trigger === "auto" && isFresh(state)) {
    return json({ ok: true, triggered: false, status: "not_due", runId: null, result: null });
  }

  if (trigger === "manual" && state?.last_attempt_at) {
    const last = Date.parse(state.last_attempt_at);
    const waitMs = Number.isFinite(last) ? MANUAL_COOLDOWN_MS - (Date.now() - last) : 0;
    if (waitMs > 0) {
      const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
      return fail("cooldown", 429, { "retry-after": String(retryAfter) });
    }
  }

  const runId = crypto.randomUUID();

  if (typeof runtime?.waitUntil === "function") {
    const work = runSync({
      supabase,
      trigger,
      runId,
      env: runtime.env,
      fetchImpl: runtime.fetch,
    }).catch((error) => {
      console.error(`[app] ${error?.code || "sync_failed"}`);
    });
    runtime.waitUntil(work);
    return json({ ok: true, triggered: true, status: "running", runId, result: null }, 202);
  }

  try {
    const outcome = await runSync({
      supabase,
      trigger,
      runId,
      env: runtime?.env,
      fetchImpl: runtime?.fetch,
    });
    if (outcome.busy) return fail("sync_busy", 409, { "retry-after": "20" });
    return json({
      ok: true,
      triggered: true,
      status: outcome.status,
      runId: outcome.runId,
      result: outcome.result,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Same-origin application entry point. Every action is routed by the `action`
 * query parameter so the physical Function pathname does not matter.
 */
export async function handleApp({ request, supabase, runtime = globalThis }) {
  const params = new URL(request.url).searchParams;
  const action = params.get("action");

  if (!action || !KNOWN_ACTIONS.has(action)) return fail("not_found", 404);

  const allowed = action === "sync" ? "POST" : "GET";
  if (request.method !== allowed) {
    return fail("method_not_allowed", 405, { allow: allowed });
  }

  try {
    if (action === "timeline") return await timeline({ params, supabase });
    if (action === "event") return await event({ params, supabase });
    if (action === "status") return await status({ supabase, runtime });
    if (action === "standard") return standard();
    return await sync({ request, supabase, runtime });
  } catch (error) {
    return handleError(error);
  }
}
