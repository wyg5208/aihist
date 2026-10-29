import { sha256Hex } from "./http.mjs";
import { SOURCES, loadSources } from "./sources.mjs";
import { CATEGORY_KEYS, modelFamilyKey, modelKeyOf, normalizeResults } from "./normalize.mjs";
import { clusterCandidates, confidenceOf, fingerprintOf } from "./cluster.mjs";
import {
  MIN_INCLUDE_VOTES,
  RUBRIC_VERSION,
  RULE_PANEL_THRESHOLD,
  aggregateReviews,
  applyTierLines,
  assessCandidate,
  buildPanelConfig,
  decisionRecord,
  judgeBatch,
  reviewSummary,
  ruleDecision,
  shouldAuditOut,
} from "./editorial.mjs";
import { SEED_EVENTS, SEED_STAMP } from "./seed.mjs";
import { autoSlug, seedSlug } from "./slug.mjs";
import {
  acquireLease,
  finishRun,
  heartbeat,
  insertEvents,
  insertRawItems,
  leaseIsHeld,
  loadAuditEvents,
  loadRecentEvents,
  loadReviewDecisions,
  loadSluglessEvents,
  readState,
  releaseLease,
  startRun,
  updateEvents,
  updateSeedVersion,
  upsertReviewDecisions,
} from "./db.mjs";

const RUN_BUDGET_MS = 22_000;
const FETCH_BUDGET_MS = 13_000;
export const MAX_RAW_ITEMS = 180;
const MAX_NEW_EVENTS = 50;
const MAX_PANEL_ITEMS = 24;
const MAX_FETCH_CONCURRENCY = 5;
const RECENT_YEAR_SPAN = 2;

function stable(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function precisionOf(date) {
  if (/^\d{4}$/.test(date)) return "year";
  if (/^\d{4}-\d{2}$/.test(date)) return "month";
  return "day";
}

/**
 * Round-robin across sources before the raw cap is applied. Sources are
 * ordered by configuration, and OpenRouter alone returns hundreds of models;
 * a plain slice would spend the whole run budget on one source and drop every
 * feed, including the domestic outlets.
 */
function interleaveCandidates(candidates, limit) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.evidence?.[0]?.sourceKey || candidate.key?.split(":")[0] || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const queues = [...groups.values()].map((rows) => rows.slice(0, 40));
  const out = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const queue of queues) {
      if (!queue.length) continue;
      out.push(queue.shift());
      added = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

function timestampOf(date) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01T00:00:00.000Z`;
  if (/^\d{4}$/.test(date)) return `${date}-01-01T00:00:00.000Z`;
  return null;
}

function fallbackSummary(candidate) {
  const title = candidate.titleEn || candidate.title;
  return candidate.summary || `${title}`;
}

function eventRow(candidate, nowIso) {
  const date = candidate.eventDate || candidate.sortDate || `${candidate.year || 2025}-01-01`;
  const year = candidate.year || Number(date.slice(0, 4));
  const families = [
    ...new Set((candidate.evidence || []).map((source) => source.family || "official")),
  ];
  const slug =
    (candidate.origin === "seed" ? seedSlug(candidate.seedId) : "") ||
    autoSlug(year, candidate.fingerprint);
  return {
    id: crypto.randomUUID(),
    slug: slug || null,
    fingerprint: candidate.fingerprint,
    event_date: date,
    date_precision: candidate.datePrecision || precisionOf(date),
    sort_date: candidate.sortDate || date,
    year,
    title: candidate.title,
    title_en: candidate.titleEn || null,
    summary: fallbackSummary(candidate),
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
    editorial_status:
      candidate.origin === "seed" ? "admitted" : candidate.editorialStatus || null,
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
    const families = [
      ...new Set((candidate.evidence || []).map((s) => s.family || "official")),
    ];
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

async function seedSlugMap() {
  const map = new Map();
  for (const candidate of SEED_EVENTS) {
    const families = [
      ...new Set((candidate.evidence || []).map((source) => source.family || "official")),
    ];
    const importance = candidate.curatedImportance ?? 50;
    const fingerprint = await fingerprintOf({
      ...candidate,
      importance,
      confidence: confidenceOf({ families }, importance),
      sourceCount: (candidate.evidence || []).length,
    });
    const slug = seedSlug(candidate.seedId);
    if (slug) map.set(fingerprint, slug);
  }
  return map;
}

/**
 * One-off, idempotent backfill for rows created before slugs existed. Slugs are
 * never derived from titles, so a later title edit cannot break a citation.
 */
async function backfillSlugs(supabase) {
  const rows = await loadSluglessEvents(supabase, 300);
  if (!rows.length) return 0;
  const seeds = await seedSlugMap();
  const patches = [];
  for (const row of rows) {
    const slug = seeds.get(row.fingerprint) || autoSlug(row.year, row.fingerprint);
    if (slug) patches.push({ id: row.id, patch: { slug } });
  }
  return patches.length ? updateEvents(supabase, patches) : 0;
}

async function rawRows(candidates, nowIso) {
  const rows = [];
  const seen = new Set();
  for (const candidate of candidates) {
    for (const source of candidate.evidence || []) {
      if (!source?.url) continue;
      const externalId = source.externalId || source.url;
      const fingerprint = await sha256Hex(
        `${source.name || candidate.title}|${externalId}`
      );
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      rows.push({
        id: crypto.randomUUID(),
        fingerprint,
        source_family: source.family || "official",
        source_name: source.name || "Unknown",
        external_id: externalId,
        title: (source.title || candidate.title || "").slice(0, 500),
        url: source.url,
        published_at: timestampOf(candidate.eventDate || candidate.sortDate),
        payload: {
          category: candidate.category,
          titleEn: candidate.titleEn || null,
          modelKey: candidate.modelKey || null,
          meta: candidate.meta || {},
        },
        fetched_at: nowIso,
      });
      if (rows.length >= MAX_RAW_ITEMS) return rows;
    }
  }
  return rows;
}

function updatePatch(item, row) {
  const sources = item.evidence || [];
  const patch = {
    sources,
    source_families: [...new Set(sources.map((source) => source.family || "official"))],
    confidence: item.confidence,
    source_count: sources.length,
    importance: item.importance,
    tags: item.tags || [],
    meta: item.meta || {},
    updated_at: new Date().toISOString(),
  };
  if (row.origin !== "seed") {
    patch.title = item.title;
    patch.title_en = item.titleEn || null;
    patch.summary = fallbackSummary(item);
    patch.summary_kind = item.summaryKind || "excerpt";
    patch.organization = item.organization || null;
    patch.model_name = item.modelName || null;
  }
  return patch;
}

function changed(item, row) {
  const sources = item.evidence || [];
  return (
    stable(sources) !== stable(row.sources || []) ||
    item.confidence !== row.confidence ||
    item.importance !== row.importance ||
    sources.length !== (row.source_count ?? (row.sources || []).length) ||
    (row.origin !== "seed" &&
      (item.title !== row.title || (item.summary && item.summary !== row.summary)))
  );
}

function auditCandidate(row) {
  return {
    fingerprint: row.fingerprint,
    title: row.title,
    titleEn: row.title_en,
    summary: row.summary,
    eventDate: row.event_date,
    year: row.year,
    category: row.category,
    organization: row.organization,
    modelName: row.model_name,
    modelKey: row.model_name ? modelKeyOf(row.model_name) : "",
    familyKey: row.model_name ? modelFamilyKey(row.model_name) : "",
    sourceCount: row.source_count,
    families: Array.isArray(row.source_families) ? row.source_families : [],
    evidence: Array.isArray(row.sources) ? row.sources : [],
    signals: {},
    meta: row.meta || {},
  };
}

/**
 * How many tiers each model generation already has in the archive.
 *
 * `rows` is the same set clustering already read, so the ladder costs no extra
 * query. The name is the only stable key: `familyKey` is derived from it by
 * `modelFamilyKey` on both the stored and the candidate side.
 */
function countTiers(rows) {
  const counts = {};
  for (const row of rows) {
    if (row.category !== "model" || row.editorial_status !== "admitted") continue;
    const key = modelFamilyKey(row.model_name || "");
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function editorialPatch(status, review) {
  return {
    editorial_status: status,
    editorial_review: review || null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Optional LLM summarisation. Absent configuration simply leaves the template
 * summaries in place; any failure is ignored.
 */
async function enhanceSummaries(items, env, fetchImpl) {
  const base = env?.LLM_API_BASE;
  const key = env?.LLM_API_KEY;
  const model = env?.LLM_MODEL;
  if (!base || !key || !model) return false;
  const batch = items.filter((item) => !item.existingId && item.origin !== "seed").slice(0, 10);
  if (!batch.length) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是 AI 编年史的编辑。为给定事件写一句简洁、只陈述事实的中文摘要，不要推测。输出 JSON：{\"items\":[{\"id\":\"...\",\"summary\":\"...\"}]}",
          },
          {
            role: "user",
            content: JSON.stringify(
              batch.map((item) => ({
                id: item.fingerprint,
                title: item.title,
                titleEn: item.titleEn,
                date: item.eventDate,
                notes: item.summary,
              }))
            ),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return false;
    const parsed = JSON.parse(content);
    const byId = new Map(batch.map((item) => [item.fingerprint, item]));
    for (const entry of parsed?.items || []) {
      const item = byId.get(entry?.id);
      const summary = typeof entry?.summary === "string" ? entry.summary.trim() : "";
      if (item && summary.length >= 20 && summary.length <= 400) {
        item.summary = summary;
        item.summaryKind = "generated";
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function guardHeartbeat(supabase, token, runId) {
  const alive = await heartbeat(supabase, token, runId);
  if (!alive) {
    const error = new Error("lease_lost");
    error.code = "lease_lost";
    throw error;
  }
}

async function insertInBatches(supabase, rows, size = 20) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    inserted += await insertEvents(supabase, rows.slice(i, i + size));
  }
  return inserted;
}

/**
 * One synchronisation run. Returns a compact result; never exposes upstream
 * payloads, SQL or credentials to the caller.
 */
export async function runSync({
  supabase,
  trigger = "manual",
  now = new Date(),
  fetchImpl = globalThis.fetch,
  env = globalThis,
  signal,
  editorial = true,
  runId = crypto.randomUUID(),
  token = crypto.randomUUID(),
}) {
  const startMs = now.getTime();
  const state = await readState(supabase);

  if (leaseIsHeld(state, startMs)) {
    return { ok: false, busy: true, runId: null, status: "busy", result: null };
  }

  const lease = await acquireLease(supabase, state, { runId, token, now, trigger });
  if (!lease.ok) {
    return { ok: false, busy: true, runId: null, status: "busy", result: null };
  }

  const seedNeeded = state?.seed_version !== SEED_STAMP;

  try {
    await startRun(supabase, { runId, trigger, now });
  } catch {
    try {
      await releaseLease(supabase, token, runId, { status: "failed" });
    } catch {
      /* best effort */
    }
    throw Object.assign(new Error("run_start_failed"), { code: "run_start_failed" });
  }

  const notes = [];
  let seedInserted = 0;
  let rawCount = 0;
  let createdCount = 0;
  let mergedCount = 0;
  let reviewedCount = 0;
  let admittedCount = 0;
  let excludedCount = 0;
  let heldCount = 0;
  let panelConfigured = false;
  let failedSources = [];
  let status = "succeeded";

  try {
    const nowIso = new Date().toISOString();

    if (seedNeeded) {
      try {
        await guardHeartbeat(supabase, token, runId);
        const rows = await seedRows(nowIso);
        seedInserted = await insertInBatches(supabase, rows, 20);
        notes.push(`seed:${rows.length}`);
      } catch (error) {
        if (error?.code === "lease_lost") throw error;
        notes.push("seed_failed");
      }
    }

    const fetchDeadline = Math.min(startMs + RUN_BUDGET_MS, startMs + FETCH_BUDGET_MS);
    const results = await loadSources(SOURCES, {
      fetchImpl,
      deadline: fetchDeadline,
      concurrency: MAX_FETCH_CONCURRENCY,
      signal,
    });
    const normalized = normalizeResults(results);
    failedSources = normalized.failed.map((entry) => entry.key);
    if (failedSources.length) {
      status = failedSources.length === results.length ? "failed" : "partial";
      notes.push(`sources:${failedSources.length}/${results.length}`);
      notes.push(
        `failed:${normalized.failed
          .map((entry) => `${entry.key}=${entry.error || "unknown"}`)
          .join(",")}`
      );
    }

    const candidates = interleaveCandidates(normalized.candidates, MAX_RAW_ITEMS);

    await guardHeartbeat(supabase, token, runId);
    const raw = await rawRows(candidates, nowIso);
    rawCount = raw.length;
    if (raw.length) {
      await insertRawItems(supabase, raw);
    }

    const existingRows = await loadRecentEvents(supabase, now.getUTCFullYear() - RECENT_YEAR_SPAN, 600);
    const { items, updates } = await clusterCandidates(candidates, existingRows);

    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const freshAll = items.filter((item) => !item.existingId).slice(0, MAX_NEW_EVENTS);
    const changedUpdates = updates
      .map((item) => {
        const row = existingById.get(item.existingId);
        if (!row) return null;
        if (!changed(item, row)) return null;
        return { id: item.existingId, patch: updatePatch(item, row) };
      })
      .filter(Boolean);

    const accepted = [];
    if (!editorial) {
      // Catalogue checks use this switch to measure parsing and matching only.
      // It is never reachable from the HTTP handler.
      accepted.push(...freshAll);
      for (const item of accepted) item.editorialStatus = "admitted";
    } else {
      const panel = buildPanelConfig(env);
      panelConfigured = panel.configured;
      const auditRows = await loadAuditEvents(supabase, 120);
      const allCandidates = [
        ...freshAll,
        ...auditRows.map((row) => auditCandidate(row)),
      ];
      const cached = await loadReviewDecisions(
        supabase,
        allCandidates.map((candidate) => candidate.fingerprint)
      );
      const panelQueue = [];
      const auditPatches = new Map();
      const decisions = [];

      for (const item of freshAll) {
        const cachedRow = cached.get(item.fingerprint);
        if (cachedRow && cachedRow.rubric_version === RUBRIC_VERSION) {
          if (cachedRow.decision === "include") {
            item.editorialStatus = "admitted";
            item.editorialReview = {
              version: cachedRow.rubric_version,
              source: cachedRow.decision_source || "panel",
              decision: "include",
              score: cachedRow.score,
              includeVotes: cachedRow.include_votes,
              validVotes: cachedRow.valid_votes,
              votes: cachedRow.votes || [],
              at: cachedRow.decided_at,
            };
            accepted.push(item);
            admittedCount += 1;
            continue;
          }
          if (cachedRow.decision === "exclude") {
            excludedCount += 1;
            continue;
          }
        }
        const assessment = assessCandidate(item);
        if (assessment.disqualify || assessment.score < RULE_PANEL_THRESHOLD) {
          const outcome = ruleDecision(item, assessment);
          decisions.push(decisionRecord(item, outcome, { runId, source: "rule" }));
          excludedCount += 1;
          continue;
        }
        panelQueue.push({ kind: "new", candidate: item, assessment });
      }

      for (const row of auditRows) {
        const candidate = auditCandidate(row);
        const cachedRow = cached.get(candidate.fingerprint);
        if (
          cachedRow &&
          cachedRow.rubric_version === RUBRIC_VERSION &&
          cachedRow.decision !== "hold"
        ) {
          const status = cachedRow.decision === "include" ? "admitted" : "excluded";
          auditPatches.set(row.id, {
            id: row.id,
            patch: editorialPatch(status, {
              version: cachedRow.rubric_version,
              source: cachedRow.decision_source || "panel",
              decision: cachedRow.decision,
              score: cachedRow.score,
              includeVotes: cachedRow.include_votes,
              validVotes: cachedRow.valid_votes,
              votes: cachedRow.votes || [],
              at: cachedRow.decided_at,
            }),
          });
          if (status === "excluded") excludedCount += 1;
          else admittedCount += 1;
          continue;
        }
        const assessment = assessCandidate(candidate);
        if (shouldAuditOut(candidate, assessment)) {
          const outcome = ruleDecision(candidate, assessment);
          decisions.push(decisionRecord(candidate, outcome, { runId, source: "rule" }));
          auditPatches.set(row.id, {
            id: row.id,
            patch: editorialPatch("excluded", reviewSummary(outcome, "rule")),
          });
          excludedCount += 1;
          continue;
        }
        if (panel.configured) {
          panelQueue.push({ kind: "audit", candidate, row, assessment });
        } else {
          // Fail closed. Rows written before the editorial gate had no panel
          // verdict; keep them out of the public timeline until three models
          // can judge them. The next run picks held rows up again.
          auditPatches.set(row.id, {
            id: row.id,
            patch: editorialPatch("hold", {
              version: RUBRIC_VERSION,
              source: "legacy",
              decision: "hold",
              score: assessment.score,
              includeVotes: 0,
              validVotes: 0,
              votes: [],
              at: new Date().toISOString(),
            }),
          });
          heldCount += 1;
        }
      }

      panelQueue.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "new" ? -1 : 1;
        return b.assessment.score - a.assessment.score;
      });
      const batch = panelQueue.slice(0, MAX_PANEL_ITEMS);
      const deferred = panelQueue.slice(MAX_PANEL_ITEMS);
      for (const entry of deferred) {
        heldCount += 1;
        if (entry.kind === "audit") {
          auditPatches.set(entry.row.id, {
            id: entry.row.id,
            patch: editorialPatch("hold", {
              version: RUBRIC_VERSION,
              source: "deferred",
              decision: "hold",
              score: entry.assessment.score,
              includeVotes: 0,
              validVotes: 0,
              votes: [],
              at: new Date().toISOString(),
            }),
          });
        }
      }
      if (deferred.length) notes.push(`panel:deferred:${deferred.length}`);

      if (batch.length) {
        if (panel.configured) {
          const results = await judgeBatch(
            panel.judges,
            batch.map((entry) => entry.candidate),
            { fetchImpl, timeoutMs: panel.timeoutMs, signal }
          );
          const aggregate = aggregateReviews(
            results,
            batch.map((entry) => entry.candidate)
          );
          // The ladder runs after the ballots: the panel's median orders a
          // generation, the ladder decides how many of its tiers may pass.
          applyTierLines(
            aggregate.byId,
            batch.map((entry) => entry.candidate),
            countTiers(existingRows)
          );
          const okCount = results.filter((result) => result.ok).length;
          notes.push(`panel:${okCount}/${panel.judges.length}`);
          if (aggregate.failures.length) {
            notes.push(
              `panel_failed:${aggregate.failures
                .map((failure) => `${failure.judge}=${failure.error}`)
                .join(",")}`
            );
          }
          for (const entry of batch) {
            const outcome = aggregate.byId.get(entry.candidate.fingerprint);
            if (!outcome) {
              heldCount += 1;
              continue;
            }
            if (outcome.validVotes >= MIN_INCLUDE_VOTES) {
              decisions.push(
                decisionRecord(entry.candidate, outcome, { runId, source: "panel" })
              );
            }
            if (outcome.decision === "include") {
              admittedCount += 1;
              if (entry.kind === "new") {
                entry.candidate.editorialStatus = "admitted";
                entry.candidate.editorialReview = reviewSummary(outcome, "panel");
                accepted.push(entry.candidate);
              } else {
                auditPatches.set(entry.row.id, {
                  id: entry.row.id,
                  patch: editorialPatch("admitted", reviewSummary(outcome, "panel")),
                });
              }
            } else if (outcome.decision === "exclude") {
              excludedCount += 1;
              if (entry.kind === "audit") {
                auditPatches.set(entry.row.id, {
                  id: entry.row.id,
                  patch: editorialPatch("excluded", reviewSummary(outcome, "panel")),
                });
              }
            } else {
              heldCount += 1;
              if (entry.kind === "audit") {
                auditPatches.set(entry.row.id, {
                  id: entry.row.id,
                  patch: editorialPatch("hold", reviewSummary(outcome, "panel")),
                });
              }
            }
          }
        } else {
          notes.push("panel:unconfigured");
          heldCount += batch.length;
        }
      }

      if (auditPatches.size) {
        await guardHeartbeat(supabase, token, runId);
        await updateEvents(supabase, [...auditPatches.values()]);
      }
      if (decisions.length) {
        try {
          await upsertReviewDecisions(supabase, decisions);
        } catch (error) {
          if (error?.code === "lease_lost") throw error;
          notes.push("review_write_failed");
        }
      }
      reviewedCount = admittedCount + excludedCount + heldCount;
      if (admittedCount) notes.push(`review_admitted:${admittedCount}`);
      if (excludedCount) notes.push(`review_excluded:${excludedCount}`);
      if (heldCount) notes.push(`review_held:${heldCount}`);
    }

    if (
      accepted.length &&
      Date.now() < startMs + RUN_BUDGET_MS - 9000 &&
      (await enhanceSummaries(accepted, env, fetchImpl))
    ) {
      notes.push("summary:llm");
    }

    await guardHeartbeat(supabase, token, runId);
    if (accepted.length) {
      createdCount = await insertInBatches(
        supabase,
        accepted.map((item) => eventRow(item, nowIso)),
        20
      );
    }
    if (changedUpdates.length) {
      mergedCount = await updateEvents(supabase, changedUpdates.slice(0, MAX_NEW_EVENTS));
    }

    try {
      const slugged = await backfillSlugs(supabase);
      if (slugged) notes.push(`slug:${slugged}`);
    } catch (error) {
      if (error?.code === "lease_lost") throw error;
      notes.push("slug_failed");
    }

    if (freshAll.length >= MAX_NEW_EVENTS) notes.push("cap:events");

    if (Date.now() > startMs + RUN_BUDGET_MS) notes.push("stage:deadline");

    const finalStatus =
      status === "failed" && (seedInserted > 0 || createdCount + mergedCount > 0)
        ? "partial"
        : status;

    const result = {
      status: finalStatus,
      seedInserted,
      rawCount,
      createdCount,
      mergedCount,
      reviewedCount,
      admittedCount,
      excludedCount,
      heldCount,
      panelConfigured,
      failedSources,
      notes: notes.join("; ") || null,
    };

    await finishRun(supabase, runId, result);
    if (seedNeeded && (finalStatus === "succeeded" || finalStatus === "partial")) {
      await updateSeedVersion(supabase, token, runId, SEED_STAMP);
    }
    await releaseLease(supabase, token, runId, {
      status: finalStatus,
      seedVersion: seedNeeded && finalStatus !== "failed" ? SEED_STAMP : undefined,
    });
    return { ok: true, busy: false, runId, status: finalStatus, result };
  } catch (error) {
    const code = error?.code || "sync_failed";
    const dbCode = typeof error?.dbCode === "string" ? `:${error.dbCode}` : "";
    const failedResult = {
      status: "failed",
      rawCount,
      createdCount,
      mergedCount,
      reviewedCount,
      admittedCount,
      excludedCount,
      heldCount,
      panelConfigured,
      failedSources,
      notes: [...notes, `stage:${code}${dbCode}`].join("; "),
    };
    try {
      await finishRun(supabase, runId, failedResult);
    } catch {
      /* best effort */
    }
    try {
      await releaseLease(supabase, token, runId, { status: "failed" });
    } catch {
      /* best effort */
    }
    throw Object.assign(new Error(code), { code });
  }
}
