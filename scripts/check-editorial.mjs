/**
 * Offline checks for the editorial gate: rule pre-screen, five-vendor panel,
 * majority aggregation, fail-closed behaviour, audit of legacy rows and the
 * public API surface. No network and no credentials.
 *
 *   node scripts/check-editorial.mjs
 */
import {
  INCLUDE_SCORE,
  MIN_INCLUDE_VOTES,
  PANEL_SIZE,
  RUBRIC_VERSION,
  STANDARD,
  aggregateReviews,
  assessCandidate,
  buildPanelConfig,
  judgeBatch,
} from "../functions/lib/editorial.mjs";
import { countEvents, queryTimeline } from "../functions/lib/db.mjs";
import { handleApp } from "../functions/handler.mjs";
import { runSync } from "../functions/lib/pipeline.mjs";
import { createFakeSupabase } from "../dev/fake-supabase.mjs";
import { fixtureFetch } from "../dev/fixture-fetch.mjs";
import { PANEL_ENV, panelFetch } from "../dev/fake-panel.mjs";

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function report(label, value) {
  console.log(`${label.padEnd(28)} ${value}`);
}

function makeCandidate(overrides = {}) {
  const evidence = overrides.evidence || [
    { name: "钛媒体", family: "media", url: "https://example.com/a" },
  ];
  return {
    fingerprint: overrides.fingerprint || `fp-${Math.random().toString(16).slice(2)}`,
    title: "OpenAI 发布 GPT-6",
    titleEn: null,
    summary: "示例摘要",
    eventDate: "2026-10-01",
    year: 2026,
    category: "model",
    organization: "OpenAI",
    modelName: "GPT-6",
    sourceCount: evidence.length,
    families: [...new Set(evidence.map((source) => source.family))],
    evidence,
    signals: {},
    meta: {},
    ...overrides,
  };
}

function expectFlag(expected, title, category = "policy") {
  const assessment = assessCandidate(
    makeCandidate({ title, category, modelName: null, organization: null })
  );
  const keys = assessment.flags.map((flag) => flag.key);
  check(
    `rule rejects ${expected}`,
    keys.includes(expected),
    `flags=${keys.join("+") || "none"} score=${assessment.score}`
  );
}

// ---------------------------------------------------------------------------
// 1. Deterministic pre-screen: obvious news never reaches the panel.
// ---------------------------------------------------------------------------
expectFlag("funding", "DeepSeek 完成百亿元融资，估值翻倍");
expectFlag("personnel", "某实验室任命新首席科学家");
expectFlag("business", "阿里云与车企合作落地智能座舱");
expectFlag("availability", "GPT-6 正式可用，免费额度提升");
expectFlag("event", "2026 世界人工智能大会将举行");
expectFlag("opinion", "为什么说奇瑞是一家AI公司？");
expectFlag("roundup", "Edge AI Daily 早报（10月24日）");
expectFlag("rumor", "据悉某公司即将发布新模型");
expectFlag("business-metric", "AI 应用日活突破千万，营收增长");

const policySummit = assessCandidate(
  makeCandidate({
    title: "国际人工智能安全峰会签署约束性协议",
    category: "policy",
    organization: null,
    modelName: null,
  })
);
check(
  "policy summit is not rejected as an event preview",
  !policySummit.flags.some((flag) => flag.key === "event"),
  policySummit.flags.map((flag) => flag.key).join("+") || "none"
);

const cases = [
  {
    label: "model release",
    candidate: makeCandidate({
      title: "OpenAI 发布 GPT-6，推理与上下文能力提升",
      evidence: [
        { name: "OpenAI", family: "official", url: "https://openai.com/x" },
        { name: "OpenRouter", family: "openrouter", url: "https://openrouter.ai/x" },
      ],
      signals: { headLab: true },
    }),
  },
  {
    label: "binding policy",
    candidate: makeCandidate({
      title: "欧盟《人工智能法案》正式生效",
      category: "policy",
      modelName: null,
      evidence: [{ name: "European Commission", family: "official", url: "https://europa.eu/x" }],
    }),
  },
  {
    label: "research milestone",
    candidate: makeCandidate({
      title: "DeepMind 在 Nature 发表 AlphaFold 3，结构预测取得突破",
      category: "research",
      modelName: null,
      evidence: [{ name: "Nature", family: "paper", url: "https://nature.com/x" }],
    }),
  },
  {
    label: "open weights release",
    candidate: makeCandidate({
      title: "Meta 开源 Llama 6 70B 权重",
      modelName: "Llama 6",
      evidence: [
        { name: "Hugging Face", family: "huggingface", url: "https://huggingface.co/x" },
        { name: "Meta AI", family: "official", url: "https://ai.meta.com/x" },
      ],
    }),
  },
];
for (const entry of cases) {
  const assessment = assessCandidate(entry.candidate);
  check(
    `rule keeps ${entry.label}`,
    !assessment.disqualify && assessment.score >= 35,
    `score=${assessment.score} flags=${assessment.flags.map((flag) => flag.key).join("+") || "none"}`
  );
}

const tier = makeCandidate({
  title: "Qwen 发布 Qwen3 8B 指令微调版",
  modelName: "Qwen3-8B-Instruct",
  familyKey: "qwen3",
  modelKey: "qwen3-8b-instruct",
  evidence: [{ name: "Hugging Face", family: "huggingface", url: "https://huggingface.co/q" }],
});
const plain = makeCandidate({
  title: "Qwen 发布 Qwen3 8B 指令微调版",
  modelName: "Qwen3-8B-Instruct",
  evidence: [{ name: "Hugging Face", family: "huggingface", url: "https://huggingface.co/q" }],
});
check(
  "tier variants score below a base release",
  assessCandidate(tier).score < assessCandidate(plain).score,
  `${assessCandidate(tier).score} < ${assessCandidate(plain).score}`
);

// ---------------------------------------------------------------------------
// 2. Panel configuration
// ---------------------------------------------------------------------------
const panel = buildPanelConfig(PANEL_ENV);
check(
  "panel configured from five model ids",
  panel.configured && panel.models.length === PANEL_SIZE,
  `${panel.models.length} models`
);
check("panel timeout is clamped", panel.timeoutMs === 2000, String(panel.timeoutMs));
check(
  "timeout clamps high values",
  buildPanelConfig({ ...PANEL_ENV, EDITORIAL_JUDGE_TIMEOUT_MS: "99999" }).timeoutMs === 12000
);
check(
  "duplicate model ids are rejected",
  buildPanelConfig({ ...PANEL_ENV, EDITORIAL_JUDGE_MODELS: "a,b,c,d,d" }).reason ===
    "duplicate_models"
);
check(
  "fewer model ids than the quorum are rejected",
  buildPanelConfig({ ...PANEL_ENV, EDITORIAL_JUDGE_MODELS: "a,b" }).reason === "models"
);
check(
  "a slot without a model is rejected",
  buildPanelConfig({ ...PANEL_ENV, EDITORIAL_JUDGE_MODELS: "a,b,c,d" }).reason === "models"
);
check(
  "missing key is rejected",
  buildPanelConfig({
    EDITORIAL_JUDGE_BASE: "https://judge.local/v1",
    EDITORIAL_JUDGE_MODELS: "a,b,c,d,e",
  }).reason === "key"
);
const threeVendors = buildPanelConfig({
  EDITORIAL_JUDGE_1_MODEL: "alpha",
  EDITORIAL_JUDGE_1_BASE: "https://one/v1",
  EDITORIAL_JUDGE_1_KEY: "k1",
  EDITORIAL_JUDGE_2_MODEL: "beta",
  EDITORIAL_JUDGE_2_BASE: "https://two/v1",
  EDITORIAL_JUDGE_2_KEY: "k2",
  EDITORIAL_JUDGE_3_MODEL: "gamma",
  EDITORIAL_JUDGE_3_BASE: "https://three/v1",
  EDITORIAL_JUDGE_3_KEY: "k3",
});
check(
  "three configured vendors are enough for a quorum",
  threeVendors.configured && threeVendors.judges.length === MIN_INCLUDE_VOTES,
  `${threeVendors.judges.length} judges`
);
const slots = buildPanelConfig({
  EDITORIAL_JUDGE_BASE: "https://shared/v1",
  EDITORIAL_JUDGE_KEY: "shared",
  EDITORIAL_JUDGE_MODELS: "a,b,c,d,e",
  EDITORIAL_JUDGE_2_MODEL: "b2",
  EDITORIAL_JUDGE_2_BASE: "https://second/v1",
  EDITORIAL_JUDGE_2_KEY: "second",
});
check(
  "per-slot overrides win",
  slots.configured &&
    slots.models[1] === "b2" &&
    slots.judges[1].base === "https://second/v1" &&
    slots.judges[1].key === "second"
);

// ---------------------------------------------------------------------------
// 3. Majority vote and fail-closed aggregation
// ---------------------------------------------------------------------------
const ballot = (id, slot, score, vote) => ({
  slot,
  model: `m${slot}`,
  ok: true,
  error: null,
  reviews: new Map([[id, { score, vote, flags: [], reason: "" }]]),
});
const failed = (slot) => ({
  slot,
  model: `m${slot}`,
  ok: false,
  error: "timeout",
  reviews: new Map(),
});
const one = [{ fingerprint: "c1" }];

function aggregate(results) {
  return aggregateReviews(results, one).byId.get("c1");
}

const unanimous = aggregate([
  ballot("c1", 1, 88, "include"),
  ballot("c1", 2, 82, "include"),
  ballot("c1", 3, 79, "include"),
  ballot("c1", 4, 80, "include"),
  ballot("c1", 5, 85, "include"),
]);
check(
  "5/5 include is admitted",
  unanimous.decision === "include" && unanimous.includeVotes === PANEL_SIZE,
  `${unanimous.decision} ${unanimous.includeVotes}/${unanimous.validVotes}`
);
const majority = aggregate([
  ballot("c1", 1, 90, "include"),
  ballot("c1", 2, 80, "include"),
  ballot("c1", 3, 78, "include"),
  ballot("c1", 4, 50, "exclude"),
  ballot("c1", 5, 45, "exclude"),
]);
check(
  "3/5 include is admitted with median score",
  majority.decision === "include" && majority.score === 78,
  `${majority.decision} ${majority.score}`
);
const twoAgainst = aggregate([
  ballot("c1", 1, 90, "include"),
  ballot("c1", 2, 60, "exclude"),
  ballot("c1", 3, 55, "exclude"),
  ballot("c1", 4, 50, "exclude"),
  ballot("c1", 5, 48, "exclude"),
]);
check(
  "4/5 exclude is rejected",
  twoAgainst.decision === "exclude" && twoAgainst.excludeVotes === 4,
  `${twoAgainst.decision} ${twoAgainst.excludeVotes}/${twoAgainst.validVotes}`
);
const split = aggregate([
  ballot("c1", 1, 90, "include"),
  ballot("c1", 2, 88, "include"),
  ballot("c1", 3, 40, "exclude"),
  ballot("c1", 4, 45, "exclude"),
  failed(5),
]);
check(
  "2-2 split is held, not admitted",
  split.decision === "hold" && split.validVotes === 4,
  `${split.decision} valid=${split.validVotes}`
);
const single = aggregate([
  ballot("c1", 1, 95, "include"),
  failed(2),
  failed(3),
  failed(4),
  failed(5),
]);
check(
  "a single valid ballot is held",
  single.decision === "hold" && single.validVotes === 1,
  `${single.decision} valid=${single.validVotes}`
);
const belowThreshold = aggregate([
  ballot("c1", 1, 70, "include"),
  ballot("c1", 2, 72, "include"),
  ballot("c1", 3, 68, "include"),
  ballot("c1", 4, 60, "include"),
  ballot("c1", 5, 55, "include"),
]);
check(
  "include votes below the score floor do not admit",
  belowThreshold.decision === "exclude" && belowThreshold.score === 68,
  `${belowThreshold.decision} score=${belowThreshold.score}`
);

// ---------------------------------------------------------------------------
// 4. Judge transport: fences, arrays, bad JSON, HTTP errors and timeouts
// ---------------------------------------------------------------------------
const judgeOne = [{ slot: 1, model: "alpha", base: "https://judge.local/v1", key: "k" }];
const judgeCandidates = [makeCandidate({ fingerprint: "judge-1", title: "OpenAI 发布 GPT-6" })];

const fenced = async () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content:
              '```json\n{"reviews":[{"id":"judge-1","score":91,"vote":"include","reason":"节点"}]}\n```',
          },
        },
      ],
    }),
    { status: 200 }
  );
const fencedResult = await judgeBatch(judgeOne, judgeCandidates, { fetchImpl: fenced });
check(
  "judge accepts fenced JSON",
  fencedResult[0].ok && fencedResult[0].reviews.get("judge-1").score === 91
);

const arrayOnly = async () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content:
              '[{"id":"judge-1","score":40,"vote":"exclude","flags":["roundup"]}]',
          },
        },
      ],
    }),
    { status: 200 }
  );
const arrayResult = await judgeBatch(judgeOne, judgeCandidates, { fetchImpl: arrayOnly });
check(
  "judge accepts a bare array",
  arrayResult[0].ok && arrayResult[0].reviews.get("judge-1").vote === "exclude"
);

const badJson = async () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
    status: 200,
  });
const badResult = await judgeBatch(judgeOne, judgeCandidates, { fetchImpl: badJson });
check("invalid judge output fails closed", !badResult[0].ok && badResult[0].error === "invalid_json");

const httpError = async () => new Response("nope", { status: 502 });
const httpResult = await judgeBatch(judgeOne, judgeCandidates, { fetchImpl: httpError });
check("judge HTTP error is reported", !httpResult[0].ok && httpResult[0].error === "http_502");

const slow = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });
const slowResult = await judgeBatch(judgeOne, judgeCandidates, {
  fetchImpl: slow,
  timeoutMs: 25,
});
check("judge timeout is reported", !slowResult[0].ok && slowResult[0].error === "timeout");

const approved = await judgeBatch(panel.judges, judgeCandidates, {
  fetchImpl: panelFetch({ mode: "approve" }),
});
check(
  "five judges each return a ballot",
  approved.filter((result) => result.ok).length === PANEL_SIZE &&
    approved.every((result) => result.reviews.get("judge-1")?.score === 88)
);

// ---------------------------------------------------------------------------
// 5. runSync: no panel means nothing new is published
// ---------------------------------------------------------------------------
const dbNoPanel = createFakeSupabase();
const noPanelRun = await runSync({
  supabase: dbNoPanel,
  trigger: "manual",
  fetchImpl: fixtureFetch,
  env: {},
});
const autoNoPanel = dbNoPanel.tables.events.filter((row) => row.origin === "auto");
check("no-panel run still seeds curated history", noPanelRun.result.seedInserted > 0);
check("no-panel run publishes no automatic rows", autoNoPanel.length === 0, `${autoNoPanel.length} rows`);
check(
  "no-panel run records why entries were held",
  String(noPanelRun.result.notes || "").includes("panel:unconfigured") &&
    noPanelRun.result.heldCount > 0,
  String(noPanelRun.result.notes)
);
check(
  "no-panel run writes no include decision",
  dbNoPanel.tables.review_decisions.every((row) => row.decision !== "include")
);

// ---------------------------------------------------------------------------
// 6. runSync: unanimous approval publishes only judged rows
// ---------------------------------------------------------------------------
const dbApprove = createFakeSupabase();
const approveRun = await runSync({
  supabase: dbApprove,
  trigger: "manual",
  fetchImpl: panelFetch({ mode: "approve" }),
  env: PANEL_ENV,
});
const autoApprove = dbApprove.tables.events.filter((row) => row.origin === "auto");
check("panel run publishes automatic rows", autoApprove.length > 0, `${autoApprove.length} rows`);
check(
  "published rows are admitted",
  autoApprove.every((row) => row.editorial_status === "admitted")
);
check(
  "published rows carry the ballot",
  autoApprove.every(
    (row) =>
      row.editorial_review?.validVotes === PANEL_SIZE &&
      row.editorial_review?.includeVotes === PANEL_SIZE &&
      row.editorial_review?.version === RUBRIC_VERSION
  ),
  JSON.stringify(autoApprove[0]?.editorial_review || null)
);
check(
  "panel run records include decisions",
  dbApprove.tables.review_decisions.some(
    (row) =>
      row.decision === "include" &&
      row.decision_source === "panel" &&
      row.valid_votes === PANEL_SIZE
  )
);
check(
  "panel run notes the ballot count",
  String(approveRun.result.notes || "").includes(`panel:${PANEL_SIZE}/${PANEL_SIZE}`),
  String(approveRun.result.notes)
);

// ---------------------------------------------------------------------------
// 7. runSync: unanimous rejection publishes nothing
// ---------------------------------------------------------------------------
const dbReject = createFakeSupabase();
const rejectRun = await runSync({
  supabase: dbReject,
  trigger: "manual",
  fetchImpl: panelFetch({ mode: "reject" }),
  env: PANEL_ENV,
});
check(
  "rejected panel run publishes no automatic rows",
  dbReject.tables.events.every((row) => row.origin !== "auto")
);
check(
  "rejected panel run records exclude decisions",
  dbReject.tables.review_decisions.some(
    (row) => row.decision === "exclude" && row.decision_source === "panel"
  )
);
check("rejected panel run holds nothing silently", rejectRun.result.heldCount === 0);

// ---------------------------------------------------------------------------
// 8. runSync: a split panel holds the candidate
// ---------------------------------------------------------------------------
const splitFetch = async (url, init = {}) => {
  if (!String(url).includes("/chat/completions")) return fixtureFetch(url, init);
  const body = JSON.parse(String(init.body || "{}"));
  if (body.model === "judge/gamma") return new Response("down", { status: 503 });
  const user = (body.messages || []).find((message) => message.role === "user");
  const payload = JSON.parse(user?.content || "{}");
  const include = body.model === "judge/alpha" || body.model === "judge/beta";
  const reviews = (payload.candidates || []).map((candidate) => ({
    id: candidate.id,
    score: include ? 88 : 40,
    vote: include ? "include" : "exclude",
  }));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reviews }) } }] }), {
    status: 200,
  });
};
const dbSplit = createFakeSupabase();
const splitRun = await runSync({
  supabase: dbSplit,
  trigger: "manual",
  fetchImpl: splitFetch,
  env: PANEL_ENV,
});
check("split panel publishes no automatic rows", dbSplit.tables.events.every((row) => row.origin !== "auto"));
check(
  "split panel records a hold decision",
  dbSplit.tables.review_decisions.some((row) => row.decision === "hold" && row.valid_votes === 4)
);
check(
  "split panel is reported as 4/5 with one failure",
  String(splitRun.result.notes || "").includes(`panel:${PANEL_SIZE - 1}/${PANEL_SIZE}`) &&
    String(splitRun.result.notes || "").includes("panel_failed:"),
  String(splitRun.result.notes)
);

// ---------------------------------------------------------------------------
// 9. Decision cache: draining and re-running adds nothing and costs nothing
// ---------------------------------------------------------------------------
let judgeCalls = 0;
const approveFetch = panelFetch({ mode: "approve" });
const countingFetch = async (url, init) => {
  if (String(url).includes("/chat/completions")) judgeCalls += 1;
  return approveFetch(url, init);
};
const dbCache = createFakeSupabase();
let drainRuns = 0;
let lastCreated = Number.POSITIVE_INFINITY;
while (drainRuns < 6 && lastCreated > 0) {
  const run = await runSync({
    supabase: dbCache,
    trigger: "manual",
    fetchImpl: countingFetch,
    env: PANEL_ENV,
  });
  lastCreated = run.result.createdCount;
  drainRuns += 1;
}
report("drain runs / judge calls", `${drainRuns} / ${judgeCalls}`);
const callsAfterDrain = judgeCalls;
const stableRun = await runSync({
  supabase: dbCache,
  trigger: "manual",
  fetchImpl: countingFetch,
  env: PANEL_ENV,
});
check("drained cache publishes nothing", stableRun.result.createdCount === 0, String(stableRun.result.createdCount));
check(
  "drained cache makes no judge calls",
  judgeCalls === callsAfterDrain,
  `${judgeCalls} vs ${callsAfterDrain}`
);

// ---------------------------------------------------------------------------
// 10. Legacy audit: obvious news is hidden, held rows are re-judged
// ---------------------------------------------------------------------------
const legacyBase = {
  event_date: "2026-10-01",
  date_precision: "day",
  sort_date: "2026-10-01",
  year: 2026,
  title_en: null,
  summary_kind: "generated",
  organization: null,
  model_name: null,
  importance: 60,
  confidence: "single",
  source_count: 1,
  source_families: ["media"],
  tags: ["行业"],
  meta: {},
  origin: "auto",
  first_seen_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};
const dbAudit = createFakeSupabase();
const legacyId = crypto.randomUUID();
const legacyNews = {
  ...legacyBase,
  id: legacyId,
  slug: "legacy-news",
  fingerprint: "legacy-news-fingerprint",
  title: "某 AI 公司完成 10 亿元融资，估值翻倍",
  summary: "融资新闻。",
  category: "policy",
  sources: [
    { name: "钛媒体", family: "media", url: "https://example.com/legacy", title: "融资" },
  ],
  editorial_status: null,
  editorial_review: null,
};
dbAudit.tables.events.push(legacyNews);
const heldId = crypto.randomUUID();
const heldRow = {
  ...legacyBase,
  id: heldId,
  slug: "held-model",
  fingerprint: "held-model-fingerprint",
  title: "Meta 开源 Llama 6 70B 权重",
  summary: "开放权重发布。",
  category: "model",
  organization: "Meta",
  model_name: "Llama 6",
  source_families: ["huggingface"],
  sources: [
    { name: "Hugging Face", family: "huggingface", url: "https://huggingface.co/held", title: "Llama 6" },
  ],
  editorial_status: "hold",
  editorial_review: null,
};
dbAudit.tables.events.push(heldRow);

const auditRun = await runSync({
  supabase: dbAudit,
  trigger: "manual",
  fetchImpl: fixtureFetch,
  env: {},
});
const legacyAfter = dbAudit.tables.events.find((row) => row.id === legacyId);
const heldAfter = dbAudit.tables.events.find((row) => row.id === heldId);
check(
  "legacy news row is excluded by the rule audit",
  legacyAfter.editorial_status === "excluded",
  String(legacyAfter.editorial_status)
);
check(
  "held row without a panel stays held",
  heldAfter.editorial_status === "hold",
  String(heldAfter.editorial_status)
);
check(
  "rule audit is recorded",
  dbAudit.tables.review_decisions.some(
    (row) => row.id === "legacy-news-fingerprint" && row.decision === "exclude"
  )
);

const visibleCount = await countEvents(dbAudit);
const timelineAll = await queryTimeline(dbAudit, { limit: 1200 });
check(
  "timeline excludes hidden rows",
  !timelineAll.items.some((row) => row.id === legacyId || row.id === heldId),
  `${timelineAll.items.length}/${timelineAll.total} visible`
);
check(
  "event count ignores hidden rows",
  visibleCount === dbAudit.tables.events.filter(
    (row) => row.editorial_status == null || row.editorial_status === "admitted"
  ).length,
  `${visibleCount} visible`
);

// ---------------------------------------------------------------------------
// 11. Public API surface
// ---------------------------------------------------------------------------
async function call(params, { method = "GET", body, env = {} } = {}) {
  const request = new Request(`https://local.test/functions/v1/app?${params}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleApp({
    request,
    supabase: dbAudit,
    runtime: { env, fetch: fixtureFetch },
  });
}

const standardResponse = await call("action=standard");
const standardBody = await standardResponse.json();
check(
  "standard endpoint is public",
  standardResponse.status === 200 &&
    standardBody.standard?.version === RUBRIC_VERSION &&
    standardBody.standard?.hardRejects?.length === STANDARD.hardRejects.length &&
    standardBody.standard?.minVotes === MIN_INCLUDE_VOTES
);

const statusResponse = await call("action=status");
const statusBody = await statusResponse.json();
check(
  "status reports an unconfigured panel without secrets",
  statusResponse.status === 200 && statusBody.panel?.configured === false,
  JSON.stringify(statusBody.panel || null)
);
check(
  "status hides lease tokens",
  !("leaseToken" in (statusBody.sync || {})) && !("lease_token" in (statusBody.sync || {}))
);

const hiddenById = await call(`action=event&id=${legacyId}`);
check("hidden event detail returns 404", hiddenById.status === 404, String(hiddenById.status));
const hiddenBySlug = await call("action=event&slug=legacy-news");
check("hidden slug detail returns 404", hiddenBySlug.status === 404, String(hiddenBySlug.status));

const badMethod = await call("action=standard", { method: "POST" });
check(
  "wrong method returns 405 with Allow",
  badMethod.status === 405 && badMethod.headers.get("allow") === "GET",
  String(badMethod.status)
);
const unknown = await call("action=nope");
check("unknown action returns 404", unknown.status === 404, String(unknown.status));

const timelineResponse = await call("action=timeline&limit=1200");
const timelineBody = await timelineResponse.json();
check(
  "timeline API hides excluded and held rows",
  timelineResponse.status === 200 &&
    !timelineBody.items.some((row) => row.editorialStatus === "excluded" || row.editorialStatus === "hold"),
  `${timelineBody.items.length} items`
);

console.log(
  failures ? `\nEditorial check failed: ${failures} case(s).` : "\nEditorial check passed."
);
process.exitCode = failures ? 1 : 0;
