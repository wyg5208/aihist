import { sha256Hex } from "./http.mjs";
import { normalizeUrl, titleTokens } from "./normalize.mjs";

const FAMILY_ORDER = [
  "official",
  "openrouter",
  "huggingface",
  "arxiv",
  "paper",
  "media",
  "community",
  "reference",
];

const PRIMARY_FAMILIES = new Set(["official", "openrouter", "huggingface", "arxiv", "paper"]);

const SOURCE_LIMIT = 6;

function familyRank(family) {
  const index = FAMILY_ORDER.indexOf(family);
  return index === -1 ? FAMILY_ORDER.length : index;
}

function sourceKeyOf(entry) {
  return `${entry.family || entry.sourceFamily || ""}|${normalizeUrl(entry.url || "") || entry.title || ""}`;
}

export function mergeSources(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const raw of list || []) {
      if (!raw || !raw.url) continue;
      const entry = {
        ...raw,
        family: raw.family || raw.sourceFamily || "",
        name: raw.name || raw.sourceName || "",
      };
      if (entry.sourceFamily) delete entry.sourceFamily;
      if (entry.sourceName) delete entry.sourceName;
      const key = sourceKeyOf(entry);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...entry });
        continue;
      }
      if ((entry.publishedAt || "") < (existing.publishedAt || "")) {
        existing.publishedAt = entry.publishedAt;
      }
      if (!existing.title && entry.title) existing.title = entry.title;
    }
  }
  return [...map.values()]
    .sort((a, b) => familyRank(a.family) - familyRank(b.family))
    .slice(0, SOURCE_LIMIT);
}

function union(a, b) {
  return [...new Set([...(a || []), ...(b || [])])];
}

function minDate(values) {
  const dates = values.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v || "")).sort();
  return dates[0] || "";
}

function pickHost(cluster) {
  return [...cluster].sort((a, b) => {
    const first = (c) => c.evidence?.[0] || {};
    const rank =
      familyRank(first(a).sourceFamily || first(a).family) -
      familyRank(first(b).sourceFamily || first(b).family);
    if (rank !== 0) return rank;
    const catRank = (c) => (c.category === "model" ? 0 : c.category === "research" ? 1 : 2);
    const cat = catRank(a) - catRank(b);
    if (cat !== 0) return cat;
    return (b.summary?.length || 0) - (a.summary?.length || 0);
  })[0];
}

function mergeMeta(target, source) {
  const meta = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    if (value == null || value === "") continue;
    if (key === "contextWindow") {
      meta.contextWindow = Math.max(Number(meta.contextWindow) || 0, Number(value) || 0);
    } else if (key === "likes" || key === "hfLikes") {
      meta[key] = Math.max(Number(meta[key]) || 0, Number(value) || 0);
    } else if (key === "openWeights") {
      meta.openWeights = Boolean(meta.openWeights) || Boolean(value);
    } else if (key === "aliases") {
      meta.aliases = union(meta.aliases, value);
    } else if (key === "hnPoints") {
      meta.hnPoints = Math.max(Number(meta.hnPoints) || 0, Number(value) || 0);
    } else if (!(key in meta)) {
      meta[key] = value;
    }
  }
  return meta;
}

export function combineCandidates(cluster) {
  const host = pickHost(cluster);
  const sources = mergeSources(...cluster.map((c) => c.evidence || []));
  const families = [...new Set(sources.map((s) => s.family))];
  const modelKeys = new Set();
  const aliases = new Set();
  const urls = new Set();
  let meta = {};
  let hnPoints = 0;
  let hfLikes = 0;
  let headLab = false;
  let officialPrimary = false;
  let sitemap = false;
  let notableOfficial = false;
  let domestic = false;
  let tokens = [];
  let tags = [];
  let familyKey = host.familyKey || host.meta?.familyKey || null;

  for (const candidate of cluster) {
    if (candidate.modelKey) modelKeys.add(candidate.modelKey);
    for (const alias of candidate.aliases || []) aliases.add(alias);
    for (const url of candidate.urls || []) if (url) urls.add(url);
    meta = mergeMeta(meta, candidate.meta);
    if (candidate.familyKey) familyKey = familyKey || candidate.familyKey;
    hnPoints = Math.max(hnPoints, candidate.signals?.hnPoints || 0);
    hfLikes = Math.max(hfLikes, candidate.signals?.hfLikes || 0);
    headLab = headLab || Boolean(candidate.signals?.headLab);
    officialPrimary = officialPrimary || Boolean(candidate.signals?.officialPrimary);
    sitemap = sitemap || Boolean(candidate.signals?.sitemap);
    notableOfficial =
      notableOfficial || Boolean(candidate.signals?.notableOfficial);
    domestic = domestic || Boolean(candidate.signals?.domestic);
    if ((candidate.tokens?.length || 0) > tokens.length) tokens = candidate.tokens;
    tags = union(tags, candidate.tags);
  }

  if (modelKeys.size) {
    const key = [...modelKeys][0];
    meta.modelKey = key;
    meta.aliases = union([...aliases], [...modelKeys]);
    meta.aliases = union(meta.aliases, [key]);
  }
  if (familyKey) meta.familyKey = familyKey;

  const primaryDates = sources
    .filter((s) => s.family !== "community")
    .map((s) => (s.publishedAt || "").slice(0, 10));
  const eventDate = minDate(primaryDates.length ? primaryDates : sources.map((s) => (s.publishedAt || "").slice(0, 10))) || host.eventDate;
  const merged = {
    ...host,
    eventDate,
    sortDate: eventDate,
    year: eventDate ? Number(eventDate.slice(0, 4)) : host.year,
    title: host.title,
    titleEn: host.titleEn,
    summary: host.summary,
    summaryKind: host.summaryKind,
    tags,
    meta,
    evidence: sources,
    urls: [...urls],
    aliases: [...aliases],
    modelKey: modelKeys.size ? [...modelKeys][0] : null,
    familyKey: familyKey || null,
    tokens: tokens.length ? tokens : host.tokens,
    signals: {
      headLab,
      hnPoints,
      hfLikes,
      officialPrimary,
      mediaOnly: families.length === 1 && families[0] === "media",
      sitemap,
      notableOfficial,
      domestic,
    },
    familyCount: families.length,
    families,
  };
  return merged;
}

function daysBetween(a, b) {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return Infinity;
  return Math.abs(left - right) / 86400_000;
}

function tokenOverlap(a, b) {
  if (!a?.length || !b?.length) return 0;
  const set = new Set(a);
  const shared = b.filter((t) => set.has(t));
  const ratio = shared.length / Math.min(a.length, b.length);
  return shared.length >= 2 && ratio >= 0.72 ? ratio : 0;
}

export function matches(a, b) {
  const keysA = new Set([...(a.aliases || []), a.modelKey].filter(Boolean));
  const keysB = new Set([...(b.aliases || []), b.modelKey].filter(Boolean));
  for (const key of keysA) {
    if (keysB.has(key)) return "model-key";
  }

  if (a.category === "model" && b.category === "model") {
    const familyA = a.familyKey || a.meta?.familyKey;
    const vendorA = a.meta?.vendorKey;
    if (familyA && familyA === (b.familyKey || b.meta?.familyKey) && vendorA && vendorA === b.meta?.vendorKey) {
      if (daysBetween(a.eventDate, b.eventDate) <= 7) return "model-family";
    }
  }

  const urlsA = new Set((a.urls || []).filter(Boolean));
  for (const url of b.urls || []) {
    if (url && urlsA.has(url)) return "url";
  }

  const hnLinks = new Set((a.evidence || []).filter((s) => s.family === "community").map((s) => normalizeUrl(s.url)));
  for (const url of b.urls || []) {
    if (url && hnLinks.has(url)) return "community-link";
  }

  if (a.category === b.category && daysBetween(a.eventDate, b.eventDate) <= 10) {
    if (tokenOverlap(a.tokens, b.tokens) > 0) return "title";
  }
  if (a.category !== "model" && b.category !== "model" && daysBetween(a.eventDate, b.eventDate) <= 3) {
    if (tokenOverlap(a.tokens, b.tokens) > 0) return "title-cross-category";
  }
  return "";
}

function importanceOf(candidate) {
  const families = candidate.families || [];
  let score = 20;
  if (families.length >= 2) score += 25;
  if (families.length >= 3) score += 10;
  if (candidate.signals?.headLab) score += 15;
  const hn = candidate.signals?.hnPoints || 0;
  if (hn >= 500) score += 12;
  else if (hn >= 200) score += 6;
  else if (hn > 0 && hn < 250) score -= 10;
  if ((candidate.signals?.hfLikes || 0) >= 1000) score += 8;
  if (candidate.signals?.officialPrimary) score += 8;
  // A preprint is a primary research artifact; the topic gate in normalize
  // already limits arXiv candidates to on-topic work.
  if (families.includes("arxiv")) score += 8;
  // Domestic AI outlets are often the first (and only) feed covering a
  // Chinese launch or policy move.
  if (candidate.signals?.domestic) score += 12;
  return Math.max(0, Math.min(100, score));
}

export function confidenceOf(candidate, importance) {
  const families = candidate.families || [];
  if (families.length >= 2) return "verified";
  if (families.length === 1 && PRIMARY_FAMILIES.has(families[0]) && importance >= 55) return "likely";
  return "single";
}

export function shouldKeep(candidate, importance, confidence) {
  if (candidate.origin === "seed") return true;
  const families = candidate.families || [];

  // Sitemap `lastmod` values are bulk-refresh stamps, not publication dates.
  // A sitemap entry can corroborate a dated item, never stand alone.
  if (candidate.signals?.sitemap && families.length === 1) return false;
  if (families.length >= 2) return true;

  if (candidate.category === "model") {
    if (families[0] === "official" && !candidate.signals?.notableOfficial) return false;
    const cross =
      families.includes("openrouter") &&
      (families.includes("huggingface") || families.includes("official") || families.includes("media"));
    const hfCross = families.includes("huggingface") && families.includes("official");
    if (!candidate.signals?.headLab && (candidate.signals?.hfLikes || 0) < 100 && !cross && !hfCross) {
      return false;
    }
    return true;
  }

  if (families[0] === "official") {
    return Boolean(candidate.signals?.notableOfficial) && importance >= 28;
  }
  // Single-source preprints are kept only when they pass the topic gate and
  // reach the preprint baseline importance; cross-source matches rank higher.
  if (families[0] === "arxiv") return importance >= 28;
  if (families[0] === "media") {
    if (candidate.signals?.domestic) return importance >= 32;
    return (candidate.signals?.hnPoints || 0) >= 300 || importance >= 55;
  }
  if (families[0] === "community") return importance >= 45;
  return confidence !== "single" || importance >= 25;
}

export async function fingerprintOf(candidate) {
  const year = candidate.year || (candidate.eventDate || "").slice(0, 4);
  let identity;
  if (candidate.modelKey) {
    identity = `model:${candidate.modelKey}|${year}`;
  } else if (candidate.seedId && !(candidate.tokens || []).length) {
    identity = `seed:${candidate.seedId}`;
  } else {
    identity = `topic:${(candidate.tokens || []).slice(0, 6).join("-")}|${year}`;
  }
  return sha256Hex(`${candidate.category}|${identity}`);
}

async function finalize(candidate) {
  const importance = candidate.curatedImportance ?? importanceOf(candidate);
  const confidence = confidenceOf(candidate, importance);
  return {
    ...candidate,
    importance,
    confidence,
    sourceCount: candidate.evidence.length,
    fingerprint: candidate.fingerprint || (await fingerprintOf(candidate)),
  };
}

function fromExisting(row) {
  const meta = row.meta || {};
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const urls = sources.map((s) => normalizeUrl(s.url)).filter(Boolean);
  return {
    id: row.id,
    existing: true,
    category: row.category,
    title: row.title,
    titleEn: row.title_en,
    eventDate: row.event_date,
    sortDate: row.sort_date,
    year: row.year,
    organization: row.organization,
    modelName: row.model_name,
    modelKey: meta.modelKey || null,
    familyKey: meta.familyKey || null,
    aliases: meta.aliases || [],
    urls,
    tokens: titleTokens(row.title_en || row.title),
    meta,
    evidence: sources,
    origin: row.origin,
    fingerprint: row.fingerprint,
    importance: row.importance,
    confidence: row.confidence,
    first_seen_at: row.first_seen_at,
    curatedImportance: row.origin === "seed" ? row.importance : undefined,
  };
}

/**
 * Group fresh candidates into events, then reconcile them with stored rows.
 * Returns { items, updates } where updates carry an existing row id.
 */
export async function clusterCandidates(candidates, existingRows = []) {
  const clusters = [];
  for (const candidate of candidates) {
    const bucket = clusters.find((c) => c.some((member) => matches(member, candidate)));
    if (bucket) bucket.push(candidate);
    else clusters.push([candidate]);
  }

  const existing = existingRows.map(fromExisting);
  const results = [];
  const updates = [];
  const byExisting = new Map();

  for (const bucket of clusters) {
    let merged = combineCandidates(bucket);
    const match = existing.find((row) => matches(row, merged));
    if (match) {
      merged = combineCandidates([
        merged,
        {
          ...match,
          urls: match.urls,
          aliases: match.aliases,
          modelKey: match.modelKey,
          tokens: [],
          evidence: match.evidence,
          meta: match.meta,
          signals: {
            headLab: false,
            hnPoints: 0,
            hfLikes: 0,
            officialPrimary: false,
            mediaOnly: false,
          },
          category: match.category,
          eventDate: match.eventDate,
        },
      ]);
      merged.existingId = match.id;
      merged.existingFingerprint = match.fingerprint;
      merged.existingOrigin = match.origin;
      merged.firstSeenAt = match.first_seen_at;
    }
    const finalized = await finalize(merged);
    if (!shouldKeep(finalized, finalized.importance, finalized.confidence)) continue;

    if (finalized.existingId) {
      const previous = byExisting.get(finalized.existingId);
      if (previous) {
        const combined = await finalize(combineCandidates([previous, finalized]));
        combined.existingId = finalized.existingId;
        combined.existingFingerprint = finalized.existingFingerprint;
        combined.existingOrigin = finalized.existingOrigin;
        combined.firstSeenAt = finalized.firstSeenAt;
        const index = results.indexOf(previous);
        if (index !== -1) results[index] = combined;
        const updateIndex = updates.indexOf(previous);
        if (updateIndex !== -1) updates[updateIndex] = combined;
        byExisting.set(finalized.existingId, combined);
      } else {
        results.push(finalized);
        updates.push(finalized);
        byExisting.set(finalized.existingId, finalized);
      }
    } else {
      results.push(finalized);
    }
  }

  results.sort((a, b) => (b.sortDate || "").localeCompare(a.sortDate || ""));
  return { items: results, updates };
}

export function summarizeConfidence(items) {
  const counts = { verified: 0, likely: 0, single: 0 };
  for (const item of items) counts[item.confidence] = (counts[item.confidence] || 0) + 1;
  return counts;
}
