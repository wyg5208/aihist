import { fixtureFetch } from "./fixture-fetch.mjs";

/** Five distinct placeholder models so the full v2 panel can run offline. */
export const PANEL_ENV = {
  EDITORIAL_JUDGE_BASE: "https://judge.local/v1",
  EDITORIAL_JUDGE_KEY: "offline-fixture",
  EDITORIAL_JUDGE_MODELS: "judge/alpha,judge/beta,judge/gamma,judge/delta,judge/epsilon",
  EDITORIAL_JUDGE_TIMEOUT_MS: "2000",
};

const NEWS =
  /融资|估值|裁员|访谈|专访|早报|日报|周报|为什么|如何|吗？|？|发布会|大会|论坛|直播|合作|签约|助力|落地|正式可用|降价|榜单|测评|预测(?:未来|明年|走势|行业|市场)/;

function reviewsFor(candidates, mode) {
  return candidates.map((candidate) => {
    const reject =
      mode === "reject" ||
      (mode === "mixed" && NEWS.test(`${candidate.title} ${candidate.titleEn || ""}`));
    return {
      id: candidate.id,
      score: reject ? 42 : 88,
      vote: reject ? "exclude" : "include",
      flags: reject ? ["offline_news_fixture"] : [],
      reason: reject ? "离线夹具判定为新闻" : "离线夹具判定为编年史节点",
    };
  });
}

/**
 * Offline stand-in for the judge endpoints. Non-judge URLs still go to the
 * recorded upstream fixtures, so the real pipeline can run end to end.
 */
export function panelFetch({ mode = "approve", failModels = [] } = {}) {
  return async (url, init = {}) => {
    if (!String(url).includes("/chat/completions")) return fixtureFetch(url, init);
    let body = {};
    try {
      body = JSON.parse(String(init.body || "{}"));
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (failModels.includes(body.model)) {
      return new Response("judge unavailable", { status: 503 });
    }
    const user = (body.messages || []).find((message) => message.role === "user");
    let payload = {};
    try {
      payload = JSON.parse(user?.content || "{}");
    } catch {
      return new Response("bad payload", { status: 400 });
    }
    const reviews = reviewsFor(payload.candidates || [], mode);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ reviews }) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
}
