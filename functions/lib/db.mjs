import { isoNow } from "./http.mjs";

export const STATE_ID = "global";
export const LEASE_TTL_MS = 150_000;
export const EVENT_COLUMNS =
  "id,slug,event_date,date_precision,sort_date,year,title,title_en,category,organization,model_name,importance,confidence,source_count,source_families,tags,origin,editorial_status,first_seen_at,updated_at";
export const EVENT_DETAIL_COLUMNS =
  "id,slug,fingerprint,event_date,date_precision,sort_date,year,title,title_en,summary,summary_kind,category,organization,model_name,importance,confidence,source_count,source_families,sources,tags,meta,origin,editorial_status,editorial_review,first_seen_at,updated_at";

/** Legacy rows (null) predate the editorial gate and stay visible. */
export function observable(query) {
  return query.or("editorial_status.is.null,editorial_status.eq.admitted");
}

function fail(error, code) {
  const wrapped = new Error(code);
  wrapped.code = code;
  if (typeof error?.code === "string") wrapped.dbCode = error.code;
  wrapped.cause = error;
  throw wrapped;
}

export async function readState(supabase) {
  const { data, error } = await supabase
    .from("sync_state")
    .select(
      "id,lease_token,lease_expires_at,run_id,last_attempt_at,last_success_at,last_status,seed_version,updated_at"
    )
    .eq("id", STATE_ID)
    .maybeSingle();
  if (error) fail(error, "state_read_failed");
  return data || null;
}

export function leaseIsHeld(state, now = Date.now()) {
  if (!state?.lease_token || !state.lease_expires_at) return false;
  const expires = Date.parse(state.lease_expires_at);
  return Number.isFinite(expires) && expires > now;
}

/**
 * Compare-and-set on the observed token. Multiple SDK calls are not a
 * transaction, so the TTL (150s) is deliberately longer than one run and all
 * event writes are idempotent by fingerprint.
 */
export async function acquireLease(supabase, state, { runId, token, now, trigger }) {
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS).toISOString();
  const stamp = now.toISOString();
  const common = {
    lease_token: token,
    lease_expires_at: expiresAt,
    run_id: runId,
    last_attempt_at: stamp,
    last_status: "running",
    updated_at: stamp,
  };

  if (!state) {
    const { data, error } = await supabase
      .from("sync_state")
      .insert({ id: STATE_ID, ...common, seed_version: null })
      .select("lease_token");
    if (error) {
      if (String(error.code) === "23505") return { ok: false, busy: true };
      fail(error, "lease_acquire_failed");
    }
    return { ok: Boolean(data?.length), busy: false, expiresAt };
  }

  let query = supabase.from("sync_state").update(common).eq("id", STATE_ID);
  if (state.lease_token == null) query = query.is("lease_token", null);
  else query = query.eq("lease_token", state.lease_token);
  const { data, error } = await query.select("lease_token");
  if (error) fail(error, "lease_acquire_failed");
  if (!data?.length) return { ok: false, busy: true };
  return { ok: true, busy: false, expiresAt };
}

export async function heartbeat(supabase, token, runId) {
  const expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("sync_state")
    .update({ lease_expires_at: expiresAt, updated_at: isoNow() })
    .eq("id", STATE_ID)
    .eq("lease_token", token)
    .eq("run_id", runId)
    .select("lease_token");
  if (error) fail(error, "heartbeat_failed");
  return Boolean(data?.length);
}

export async function releaseLease(supabase, token, runId, result) {
  const now = isoNow();
  const patch = {
    lease_token: null,
    lease_expires_at: null,
    last_status: result.status,
    updated_at: now,
  };
  if (result.seedVersion) patch.seed_version = result.seedVersion;
  if (result.status === "succeeded" || result.status === "partial") patch.last_success_at = now;
  const { error } = await supabase
    .from("sync_state")
    .update(patch)
    .eq("id", STATE_ID)
    .eq("lease_token", token)
    .eq("run_id", runId);
  if (error) fail(error, "lease_release_failed");
}

export async function startRun(supabase, { runId, trigger, now }) {
  const stamp = now.toISOString();
  const { error } = await supabase.from("sync_runs").insert({
    id: runId,
    trigger,
    status: "running",
    started_at: stamp,
    finished_at: null,
    raw_count: 0,
    created_count: 0,
    merged_count: 0,
    failed_sources: [],
    notes: null,
  });
  if (error) fail(error, "run_create_failed");
}

export async function finishRun(supabase, runId, result) {
  const { error } = await supabase
    .from("sync_runs")
    .update({
      status: result.status,
      finished_at: isoNow(),
      raw_count: result.rawCount ?? 0,
      created_count: result.createdCount ?? 0,
      merged_count: result.mergedCount ?? 0,
      failed_sources: result.failedSources ?? [],
      notes: result.notes || null,
    })
    .eq("id", runId);
  if (error) fail(error, "run_finish_failed");
}

export async function recentRuns(supabase, limit = 5) {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("id,trigger,status,started_at,finished_at,raw_count,created_count,merged_count,failed_sources,notes")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) fail(error, "runs_read_failed");
  return data || [];
}

export async function countEvents(supabase) {
  const query = observable(
    supabase.from("events").select("id", { count: "exact" }).limit(1)
  );
  const { data, error, count } = await query;
  if (error) fail(error, "count_failed");
  return typeof count === "number" ? count : Array.isArray(data) ? data.length : 0;
}

export async function loadRecentEvents(supabase, minYear, limit = 600) {
  const { data, error } = await supabase
    .from("events")
    .select("id,fingerprint,event_date,sort_date,year,title,title_en,category,organization,model_name,importance,confidence,origin,sources,meta,first_seen_at")
    .gte("year", minYear)
    .order("sort_date", { ascending: false })
    .limit(limit);
  if (error) fail(error, "events_read_failed");
  return data || [];
}

export async function findEventsByFingerprints(supabase, fingerprints) {
  const found = new Map();
  for (let i = 0; i < fingerprints.length; i += 40) {
    const chunk = fingerprints.slice(i, i + 40);
    const { data, error } = await supabase
      .from("events")
      .select("id,fingerprint,origin")
      .in("fingerprint", chunk);
    if (error) fail(error, "fingerprint_read_failed");
    for (const row of data || []) found.set(row.fingerprint, row);
  }
  return found;
}

export async function loadReviewDecisions(supabase, fingerprints) {
  const found = new Map();
  const ids = [...new Set(fingerprints.filter(Boolean))];
  // The hosted PostgREST gateway answers 414 URI_TOO_LONG well before the
  // 8 KB HTTP limit once a 64-char fingerprint list is inlined. Twelve ids
  // keeps every request near 800 bytes; a fresh sync can carry ~170 ids.
  const CHUNK = 12;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("review_decisions")
      .select("id,fingerprint,rubric_version,decision,score,include_votes,valid_votes,votes,decided_at")
      .in("id", chunk);
    if (error) fail(error, "review_read_failed");
    for (const row of data || []) found.set(row.id, row);
  }
  return found;
}

export async function upsertReviewDecisions(supabase, rows) {
  if (!rows.length) return 0;
  const { error } = await supabase
    .from("review_decisions")
    .upsert(rows, { onConflict: "id" });
  if (error) fail(error, "review_write_failed");
  return rows.length;
}

/**
 * Legacy auto rows without a verdict, plus held rows that deserve another
 * panel attempt once configuration or capacity changes. Seeds are curated and
 * excluded from the audit.
 */
export async function loadAuditEvents(supabase, limit = 120) {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,fingerprint,event_date,sort_date,year,title,title_en,summary,category,organization,model_name,importance,confidence,source_count,source_families,sources,meta,origin,editorial_status"
    )
    .eq("origin", "auto")
    .or("editorial_status.is.null,editorial_status.eq.hold")
    .order("sort_date", { ascending: false })
    .limit(limit);
  if (error) fail(error, "audit_read_failed");
  return data || [];
}

export async function insertRawItems(supabase, rows) {
  if (!rows.length) return 0;
  // raw_items has INSERT but no SELECT policy. Do not use `.select()` here:
  // returning representations would require read access and fail at runtime.
  const { error } = await supabase
    .from("raw_items")
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (error) fail(error, "raw_insert_failed");
  return rows.length;
}

export async function insertEvents(supabase, rows) {
  if (!rows.length) return 0;
  const { data, error } = await supabase
    .from("events")
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
    .select("id");
  if (error) fail(error, "event_insert_failed");
  return data?.length || 0;
}

export async function updateEvents(supabase, rows) {
  let changed = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const results = await Promise.all(
      batch.map((row) =>
        supabase.from("events").update(row.patch).eq("id", row.id).select("id")
      )
    );
    for (const result of results) {
      if (result.error) fail(result.error, "event_update_failed");
      if (result.data?.length) changed += 1;
    }
  }
  return changed;
}

export async function readEvent(supabase, id) {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error, "event_read_failed");
  return data || null;
}

export async function readEventBySlug(supabase, slug) {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DETAIL_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) fail(error, "event_read_failed");
  return data || null;
}

export async function loadSluglessEvents(supabase, limit = 60) {
  const { data, error } = await supabase
    .from("events")
    .select("id,fingerprint,year,origin")
    .is("slug", null)
    .limit(limit);
  if (error) fail(error, "slug_read_failed");
  return data || [];
}

export async function queryTimeline(supabase, { category, confidence, year, limit }) {
  let query = observable(
    supabase
      .from("events")
      .select(EVENT_COLUMNS, { count: "exact" })
      .order("sort_date", { ascending: false })
      .order("importance", { ascending: false })
      .limit(limit)
  );
  if (category) query = query.eq("category", category);
  if (confidence) query = query.eq("confidence", confidence);
  if (year) query = query.eq("year", year);
  const { data, error, count } = await query;
  if (error) fail(error, "timeline_read_failed");
  return { items: data || [], total: typeof count === "number" ? count : (data || []).length };
}

export async function updateSeedVersion(supabase, token, runId, version) {
  const { error } = await supabase
    .from("sync_state")
    .update({ seed_version: version, updated_at: isoNow() })
    .eq("id", STATE_ID)
    .eq("lease_token", token)
    .eq("run_id", runId);
  if (error) fail(error, "seed_version_failed");
}

export async function attachRunId(supabase, token, runId) {
  const { error } = await supabase
    .from("sync_state")
    .update({ run_id: runId, updated_at: isoNow() })
    .eq("id", STATE_ID)
    .eq("lease_token", token);
  if (error) fail(error, "run_attach_failed");
}
