/**
 * Record what the reference implementation produces for the recorded upstream
 * fixtures, so the Python port can be checked field by field.
 *
 * `nowMs` matters: date windows inside normalize are relative to the clock, so
 * the Python tests must run with this exact instant instead of the wall clock.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureFetch } from "../dev/fixture-fetch.mjs";
import { SOURCES, loadSources } from "../functions/lib/sources.mjs";
import { normalizeResults } from "../functions/lib/normalize.mjs";
import { clusterCandidates } from "../functions/lib/cluster.mjs";
import { assessCandidate } from "../functions/lib/editorial.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = join(ROOT, "backend", "tests", "fixtures", "golden");

const nowMs = Date.now();
const results = await loadSources(SOURCES, {
  fetchImpl: fixtureFetch,
  deadline: nowMs + 60_000,
  concurrency: 5,
});

const { candidates, failed } = normalizeResults(results);

const parsed = results.map((result) => ({
  key: result.key,
  ok: result.ok,
  error: result.error ?? null,
  itemCount: (result.items || []).length,
  // Every parser is deterministic, so the full parsed list is the contract.
  items: (result.items || []).map((item) => ({ ...item })),
}));

const candidateRows = candidates.map((candidate) => ({
  key: candidate.key,
  title: candidate.title,
  titleEn: candidate.titleEn,
  category: candidate.category,
  eventDate: candidate.eventDate,
  sortDate: candidate.sortDate,
  year: candidate.year,
  datePrecision: candidate.datePrecision,
  summaryKind: candidate.summaryKind,
  organization: candidate.organization,
  modelName: candidate.modelName,
  modelKey: candidate.modelKey,
  familyKey: candidate.familyKey,
  aliases: candidate.aliases,
  urls: candidate.urls,
  tokens: candidate.tokens,
  tags: candidate.tags,
  signals: candidate.signals,
  meta: candidate.meta,
  evidence: candidate.evidence,
}));

const assessments = candidates.map((candidate) => {
  const assessment = assessCandidate(candidate);
  return {
    key: candidate.key,
    score: assessment.score,
    flags: assessment.flags,
    reasons: assessment.reasons,
    disqualify: assessment.disqualify,
    eligible: assessment.eligible,
    families: assessment.families,
    sourceNames: assessment.sourceNames,
  };
});

const clustered = await clusterCandidates(candidates, []);
const clusteredRows = clustered.items.map((item) => ({
  fingerprint: item.fingerprint,
  title: item.title,
  category: item.category,
  eventDate: item.eventDate,
  importance: item.importance,
  confidence: item.confidence,
  sourceCount: item.sourceCount,
  families: item.families,
  evidenceUrls: (item.evidence || []).map((source) => source.url),
  evidenceNames: (item.evidence || []).map((source) => source.name),
}));

await mkdir(OUT_DIR, { recursive: true });
const header = { exportedAt: new Date(nowMs).toISOString(), nowMs };

await writeFile(
  join(OUT_DIR, "sources.json"),
  `${JSON.stringify({ ...header, parsed }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  join(OUT_DIR, "normalize.json"),
  `${JSON.stringify({ ...header, failed, candidates: candidateRows }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  join(OUT_DIR, "editorial.json"),
  `${JSON.stringify({ ...header, assessments }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  join(OUT_DIR, "cluster.json"),
  `${JSON.stringify({ ...header, clustered: clusteredRows }, null, 2)}\n`,
  "utf8"
);

console.log(
  `golden written at ${header.exportedAt}: ` +
    `${parsed.length} sources, ${candidates.length} candidates, ` +
    `${clusteredRows.length} clusters, ${failed.length} failed`
);
