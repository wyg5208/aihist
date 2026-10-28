import { cleanText, htmlToText } from "./http.mjs";
import { keywordsFor, keywordsFromText } from "./keywords.mjs";

export const CATEGORY_KEYS = ["milestone", "model", "research", "opinion", "policy"];

const HEAD_LABS = new Set([
  "openai",
  "anthropic",
  "google",
  "meta",
  "deepseek",
  "mistralai",
  "qwen",
  "x-ai",
  "z-ai",
  "moonshotai",
  "microsoft",
  "nvidia",
  "amazon",
  "cohere",
  "ai21",
  "baidu",
  "tencent",
  "alibaba",
  "minimax",
  "stepfun",
  "inclusionai",
  "upstage",
  "xiaomi",
  "sakana",
  "liquid",
  "bytedance",
  "perplexity",
]);

const VENDOR_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  deepseek: "DeepSeek",
  "deepseek-ai": "DeepSeek",
  mistralai: "Mistral AI",
  "mistralai-ai": "Mistral AI",
  qwen: "阿里云 Qwen",
  "qwenlm": "阿里云 Qwen",
  "x-ai": "xAI",
  "z-ai": "Z.ai",
  moonshotai: "月之暗面",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  amazon: "Amazon",
  cohere: "Cohere",
  ai21: "AI21 Labs",
  baidu: "百度",
  tencent: "腾讯",
  alibaba: "阿里巴巴",
  minimax: "MiniMax",
  stepfun: "阶跃星辰",
  inclusionai: "无问芯穹",
  upstage: "Upstage",
  xiaomi: "小米",
  sakana: "Sakana AI",
  liquid: "Liquid AI",
  bytedance: "字节跳动",
  perplexity: "Perplexity",
  "stabilityai": "Stability AI",
  "openbmb": "面壁智能",
  "01-ai": "零一万物",
};

const MODALITY_LABELS = {
  text: "文本",
  image: "图像",
  audio: "音频",
  video: "视频",
  file: "文件",
};

const STOPWORDS = new Set(
  (
    "a an the and or but of for to in on at by with from as is are was were be been being " +
    "this that these those it its into over under after before about against between during " +
    "new now how why what when where who whom which will would can could may might should " +
    "we you they he she i our your their his her not no more most less than then so just " +
    "via using use used make makes made get gets got one two three first last next " +
    "show ask asks says said report reports update updates"
  ).split(" ")
);

const TOPIC_WORDS =
  /\b(llm|llms|language model|language models|transformer|reasoning|agent|agents|agentic|multimodal|alignment|rlhf|rlvr|diffusion|retrieval|rag|benchmark|scaling|fine[- ]tuning|instruction|vision[- ]language|speech|code|robotics|safety|interpretability|mixture[- ]of[- ]experts|moe|long[- ]context|world model|chain[- ]of[- ]thought|inference|post[- ]training|pretraining|pre[- ]training|foundation model|generative)\b/i;

const MODEL_WORD =
  /\b(gpt|chatgpt|claude|gemini|llama|qwen|deepseek|mistral|grok|kimi|glm|minimax|command|phi|nemotron|olmo|yi|wan|hunyuan|ernie|doubao|seed|mimo|solar|jamba|reka|falcon|stable diffusion|sora|veo|imagen|nano banana|gemma|granite|palm|bard|copilot)\b|通义|文心|豆包|混元|星火|可灵|日日新|盘古|悟道|书生|百川|面壁|天工|元宝|夸克|阶跃|智元|宇树/i;

const RELEASE_WORD =
  /\b(introduc\w*|launch\w*|unveil\w*|releas\w*|announc\w*|debut\w*|open[- ]sourc\w*|ship\w*|roll(?:ing)? out|now available|available today|general availability|preview)\b|发布|推出|上线|开源|开放|亮相|登场|问世|升级|迭代/i;

const RESEARCH_WORD =
  /\b(research|paper|study|benchmark\w*|arxiv|scientist\w*|science|discover\w*|breakthrough|evaluation|evaluat\w*|interpretab\w*|dataset|experiment\w*|proof|theorem|neurips|icml|iclr)\b|论文|研究|基准|测评|数据集|突破|登顶|刷新|实验|算法|nature|science/i;

const POLICY_WORD =
  /\b(polic\w*|regulat\w*|law|laws|act|court|government|senate|congress|parliament|eu|european union|ban\w*|governance|security|copyright|lawsuit|investigat\w*|sanction\w*|privacy|executive order|white house|ministry|agency|compliance|antitrust|safety institute)\b|政策|监管|法案|法规|条例|备案|合规|治理|标准|白皮书|规划|指导意见|管理办法|安全评估|伦理|新规/i;

const OPINION_WORD =
  /\b(opinion|interview|essay|perspective|podcast|conversation|q&a|letter|manifesto|the case for|we think|i think|reflection\w*|lessons|thoughts|why |what |how )\b|访谈|对话|专访|观点|演讲|撰文|专栏|评论|复盘|思考|展望|判断/i;

/** Used by domestic general-tech feeds: keep only AI-relevant headlines. */
const AI_RELEVANCE =
  /(?:^|[^A-Za-z])(?:ai|llms?|agi|aigc|gpt|chatgpt|claude|gemini|llama|qwen|deepseek|kimi|glm|minimax|openai|anthropic|transformer|agents?|agentic)(?:[^A-Za-z]|$)|人工智能|大模型|生成式|智能体|机器学习|深度学习|神经网络|算法|算力|芯片|半导体|机器人|具身|脑机|自动驾驶|智能驾驶|智驾|多模态|语音|图像生成|视频生成|文生图|文生视频|开源模型|推理模型|通用人工智能|超级智能|智能眼镜|智元|宇树/i;


export function slugKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Model identity shared across catalogues. Trailing date stamps and common
 * packaging suffixes are removed so OpenRouter and Hugging Face entries meet.
 */
export function modelKeyOf(value) {
  let key = String(value || "").toLowerCase();
  if (key.includes("/")) key = key.split("/").pop();
  key = key
    .replace(/:(free|batch|thinking|online)$/g, "")
    .replace(/[-_](gguf|awq|gptq|4bit|8bit|fp8|fp16|bf16|mlx|onnx|exl2|ggml|int4|int8)$/g, "")
    .replace(/[-_](instruct|chat|it|base|preview|thinking|reasoning)$/g, "")
    .replace(/([-_]\d{4})([-_]\d{2}){1,2}$/g, "")
    .replace(/[-_]\d{4}$/g, "");
  return slugKey(key);
}

export function modelAliasesOf(value) {
  const aliases = new Set();
  const add = (v) => {
    const key = modelKeyOf(v);
    if (key) aliases.add(key);
  };
  add(value);
  const raw = String(value || "").toLowerCase();
  if (raw.includes("/")) add(raw.split("/").pop());
  return [...aliases];
}

const TIER_SUFFIX =
  /[-_.](pro|max|plus|premium|flash|flashx|mini|super|ultra|lite|air|nano|turbo|sol|luna|astra|terra|omni|prime|thinking|preview|instruct|chat|it|base|batch|free|distill|reasoner|vl|vision|audio|realtime|codex)$/g;

/**
 * Groups packaging variants of one release (e.g. `gpt-6-sol-pro` and
 * `gpt-6-luna`) so a single launch does not flood the timeline.
 */
export function modelFamilyKey(value) {
  let key = modelKeyOf(value);
  let previous = "";
  while (key !== previous) {
    previous = key;
    key = key.replace(TIER_SUFFIX, "").replace(/[-_.]+$/, "");
  }
  return key;
}

const VENDOR_ALIASES = {
  "deepseek-ai": "deepseek",
  "meta-llama": "meta",
  qwenlm: "qwen",
  "mistralai-ai": "mistralai",
  stabilityai: "stability",
  "01-ai": "01ai",
};

export function vendorKeyOf(value) {
  const key = String(value || "").toLowerCase().replace(/\s+/g, "-");
  if (VENDOR_ALIASES[key]) return VENDOR_ALIASES[key];
  return key.replace(/-(ai|hq|inc|labs|research|official)$/g, "");
}

const CJK_STOP_BIGRAMS = new Set([
  "一个",
  "我们",
  "他们",
  "可以",
  "已经",
  "正在",
  "以及",
  "对于",
  "通过",
  "进行",
  "表示",
  "目前",
  "如何",
  "什么",
  "这个",
  "那个",
  "没有",
  "还是",
]);

/**
 * Latin words plus CJK bigrams. Without the bigrams a Chinese headline would
 * yield no tokens at all, which would collapse every Chinese item in a year
 * onto the same fingerprint.
 */
export function titleTokens(title) {
  const raw = String(title || "").toLowerCase().replace(/&[a-z]+;/g, " ");
  const tokens = raw
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length >= 3 || /\d/.test(t))
    .filter((t) => !STOPWORDS.has(t));
  for (const run of raw.match(/[\u3400-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!CJK_STOP_BIGRAMS.has(bigram)) tokens.push(bigram);
    }
  }
  return [...new Set(tokens)].slice(0, 18);
}

export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(ref|source|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let path = url.pathname.replace(/\/+$/, "");
    if (host === "arxiv.org" || host === "export.arxiv.org") {
      const abs = /\/abs\/([^/]+)/.exec(path);
      if (abs) path = `/abs/${abs[1].replace(/v\d+$/, "")}`;
    }
    return `${host}${path}${url.search ? `?${url.searchParams.toString()}` : ""}`;
  } catch {
    return "";
  }
}

export function vendorLabel(vendor) {
  const key = String(vendor || "").toLowerCase();
  return VENDOR_LABELS[key] || key.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isHeadLab(vendor) {
  return HEAD_LABS.has(vendorKeyOf(vendor));
}

function formatContext(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M token`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K token`;
  return `${n} token`;
}

function modalityText(inputs) {
  const list = (inputs || []).map((m) => MODALITY_LABELS[m] || m).filter(Boolean);
  if (!list.length) return "";
  return `${[...new Set(list)].join("、")}输入`;
}

function isoDay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

// The collection window is open: a chronicle wants history, not just the last
// few weeks. These parsers used to carry their own cut-off (120 days for
// OpenRouter, 180 for Hugging Face, 10 for arXiv, 14 for Hacker News, 21/45 for
// feeds), which dropped DeepSeek-R1 (2025-01) and V3 (2024-12) as "too old".

const BASE_MODEL_PREFIX = "base_model:";
const QUANT_NAME_RE =
  /(?:^|[-_.])(?:gguf|awq|gptq|fp8|fp16|fp4|mlx|onnx|exl2|ggml|int4|int8|4bit|8bit|bf16|comfy)(?:$|[-_.])|\b\d+(?:\.\d+)?gb\b/i;

function baseModelRepo(tag) {
  let repo = tag.slice(BASE_MODEL_PREFIX.length).trim();
  for (const kind of ["quantized:", "finetune:", "adapter:", "merge:", "quantized-"]) {
    if (repo.startsWith(kind)) return repo.slice(kind.length).trim();
  }
  return repo;
}

/**
 * Is this repository someone else's model, repackaged?
 *
 * A `gguf`/`fp8` tag says nothing about who published the weights: DeepSeek and
 * GLM ship FP8 themselves. The `base_model:` tag does name the upstream repo, so
 * a derivative is one whose upstream belongs to another author, or the author's
 * own quantized variant (their BF16 re-released as GGUF/4GB/…).
 */
function isDerivedRepo(modelId, tags) {
  if (typeof modelId !== "string" || !modelId.includes("/")) return false;
  const author = modelId.split("/")[0].trim().toLowerCase();
  for (const tag of tags || []) {
    if (typeof tag !== "string" || !tag.startsWith(BASE_MODEL_PREFIX)) continue;
    const upstream = baseModelRepo(tag);
    if (!upstream.includes("/")) continue;
    if (upstream.split("/")[0].trim().toLowerCase() !== author) return true;
    if (QUANT_NAME_RE.test(modelId.split("/").pop())) return true;
  }
  return false;
}

export function classifyTitle(title, summary, url) {
  const head = String(title || "");
  const text = `${head} ${summary || ""}`;
  if (/arxiv\.org\/(abs|pdf)\//i.test(url || "")) return "research";
  // Policy wording is specific and should win over a generic "发布/模型".
  if (POLICY_WORD.test(head)) return "policy";
  // Chinese headlines rarely use "paper/study"; treat unsettled research copy
  // as research only when it is not a product release.
  if (RESEARCH_WORD.test(head) && !RELEASE_WORD.test(head)) return "research";
  if ((MODEL_WORD.test(head) || /模型|智能体|助手/.test(head)) && RELEASE_WORD.test(head)) {
    return "model";
  }
  if (OPINION_WORD.test(head)) return "opinion";
  if (RESEARCH_WORD.test(text)) return "research";
  if (MODEL_WORD.test(text) && RELEASE_WORD.test(text)) return "model";
  if (POLICY_WORD.test(text)) return "policy";
  if (OPINION_WORD.test(text)) return "opinion";
  return "policy";
}

/**
 * Official news feeds mix first-party release notes with customer stories,
 * partnership posts and hiring news. Only the former are candidates for the
 * timeline; everything else is only usable as corroboration.
 */
const OFFICIAL_NOISE = [
  /\b(customer|customers|case study|testimonial|employees?|workers?|workplace)\b/i,
  /\b(cuts?|cut|saves?|boosts?|triples?|doubles?|halves?|frees? up|reduces?|accelerat\w*|helps?|ships?|brings?|powers?|turns?)\b/i,
  /\bwith (openai|chatgpt|gpt[-\s]?\d|claude|codex|gemini)\b/i,
  /\bhow [a-z0-9]/i,
  /\bwatch\b/i,
  /\b(partner\w*|collaborat\w*|accenture|infosys|cognizant|deloitte|pwc|kpmg|salesforce|tcs|bcg|menlo|nvidia|microsoft|amazon|google cloud|bedrock|vertex|foundry)\b/i,
  /\b(appoints?|appointed|joins?|hires?|hiring|board|managing director|general manager|head of|leadership)\b/i,
  /\b(raises?|funding|series [a-h]|valuation|invests?|investment|acquires?|acquisition|s-?1|ipo)\b/i,
  /\b(office|opens?|opening|expands?|expansion|presence|seoul|tokyo|paris|munich|milan|sydney|bengaluru|india|canada|brazil|europe|singapore|australia|iceland|rwanda|poland|uk)\b/i,
  /\b(polic\w*|terms|pricing|price|certification|compliance|deprecat\w*|limits?|api|sdk|enterprise|education|teachers?|students?|universit\w*|nonprofits?|small business|financial services|healthcare|life sciences|government|public sector|national security|defense|military|elections?|midterms|law|legal|grants?|fellowship|initiative|programmes?|programs?|fund)\b/i,
  /\b(access|availability|available|launch(?:es|ed|ing)? in|now in|coming to)\b/i,
];

export function isNotableOfficial(category, title) {
  if (typeof title !== "string" || !title.trim()) return false;
  if (OFFICIAL_NOISE.some((pattern) => pattern.test(title))) return false;
  if (category === "model") {
    return (
      RELEASE_WORD.test(title) ||
      /\b(gpt|claude|gemini|llama|qwen|deepseek|grok|kimi|glm|minimax)\b.*\d/i.test(title)
    );
  }
  if (category === "research") {
    if (MODEL_WORD.test(title)) return true;
    return /\b(research|paper|benchmark|dataset|evaluation|safety|alignment|interpretab\w*|reasoning|agents?|multimodal|mathematic\w*|coding|science|model)\b/i.test(
      title
    );
  }
  if (category === "milestone") return true;
  return false;
}

export function extractTags(value) {
  return keywordsFromText(value, 8);
}

function baseCandidate(overrides) {
  const eventDate = overrides.eventDate || "";
  return {
    key: overrides.key,
    category: overrides.category,
    title: overrides.title,
    titleEn: overrides.titleEn || null,
    summary: overrides.summary,
    summaryKind: overrides.summaryKind || "template",
    eventDate,
    datePrecision: overrides.datePrecision || "day",
    sortDate: eventDate,
    year: eventDate ? Number(eventDate.slice(0, 4)) : 0,
    organization: overrides.organization || null,
    modelName: overrides.modelName || null,
    tags: keywordsFor({
      tags: overrides.tags,
      title: overrides.title,
      titleEn: overrides.titleEn,
      summary: overrides.summary,
      organization: overrides.organization,
      modelName: overrides.modelName,
      category: overrides.category,
    }),
    meta: overrides.meta || {},
    evidence: overrides.evidence ? [overrides.evidence] : [],
    modelKey: overrides.modelKey || null,
    familyKey: overrides.familyKey || null,
    aliases: overrides.aliases || [],
    urls: overrides.urls || [],
    tokens: titleTokens(overrides.titleEn || overrides.title),
    signals: {
      headLab: Boolean(overrides.headLab),
      hnPoints: Number(overrides.hnPoints) || 0,
      hfLikes: Number(overrides.hfLikes) || 0,
      officialPrimary: Boolean(overrides.officialPrimary),
      mediaOnly: Boolean(overrides.mediaOnly),
      sitemap: Boolean(overrides.sitemap),
      notableOfficial: Boolean(overrides.notableOfficial),
      domestic: Boolean(overrides.domestic),
    },
  };
}

function openRouterCandidates(payload) {
  const seen = new Set();
  const out = [];
  for (const model of payload.items || []) {
    if (!model.created) continue;
    if (/:free$|:batch$/.test(model.id) || model.id.startsWith("~")) continue;
    if (seen.has(model.canonicalSlug)) continue;
    seen.add(model.canonicalSlug);
    const vendorKey = model.id.split("/")[0];
    const displayName = model.name.includes(":") ? model.name.split(":").slice(1).join(":").trim() : model.name;
    const vendor = vendorLabel(vendorKey);
    const openWeights = Boolean(model.huggingFaceId);
    const date = isoDay(model.created);
    const ctx = formatContext(model.contextLength);
    const modality = modalityText(model.inputModalities) || model.modality || "";
    const parts = [`${displayName} 由 ${vendor} 提供，${openWeights ? "开放权重" : "闭源 API"}模型。`];
    if (ctx) parts.push(`上下文窗口 ${ctx}。`);
    if (modality) parts.push(`支持${modality}，输出为文本。`);
    parts.push("条目由 OpenRouter 模型目录自动汇总。");
    out.push(
      baseCandidate({
        key: `openrouter:${model.id}`,
        category: "model",
        title: `${vendor} 发布 ${displayName}`,
        titleEn: model.name,
        summary: parts.join(""),
        summaryKind: "template",
        eventDate: date,
        organization: vendor,
        modelName: displayName,
        tags: [openWeights ? "开源" : "闭源", vendor],
        meta: {
          vendor,
          vendorKey: vendorKeyOf(vendorKey),
          openWeights,
          contextWindow: model.contextLength,
          modality: model.modality,
          inputModalities: model.inputModalities,
          openRouterId: model.id,
          canonicalSlug: model.canonicalSlug,
          huggingFaceId: model.huggingFaceId,
          familyKey: modelFamilyKey(model.id),
        },
        modelKey: modelKeyOf(model.id),
        familyKey: modelFamilyKey(model.id),
        aliases: modelAliasesOf(model.id),
        urls: [normalizeUrl(`https://openrouter.ai/${model.canonicalSlug}`)],
        headLab: isHeadLab(vendorKey),
        evidence: {
          sourceKey: "openrouter",
          sourceFamily: "openrouter",
          sourceName: "OpenRouter",
          title: model.name,
          url: `https://openrouter.ai/${model.canonicalSlug}`,
          publishedAt: model.created,
          externalId: model.id,
        },
      })
    );
  }
  return out;
}

function hfCandidates(payload) {
  const seen = new Set();
  const out = [];
  for (const model of payload.items || []) {
    if (!model.createdAt) continue;
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const tags = model.tags || [];
    if (isDerivedRepo(model.id, tags)) continue;
    if (model.likes < 20) continue;
    const repoName = model.id.split("/").pop() || model.id;
    const displayName = repoName.replace(/[-_](gguf|awq|gptq|fp8)$/i, "");
    const vendorKey = (model.author || "").toLowerCase();
    const vendor = vendorLabel(vendorKey);
    const date = isoDay(model.createdAt);
    const likes = Number(model.likes) || 0;
    const downloads = Number(model.downloads) || 0;
    const summary =
      `${displayName} 在 Hugging Face 开源发布，作者 ${vendor}。` +
      `当前获得 ${likes.toLocaleString("en-US")} 次点赞、${downloads.toLocaleString("en-US")} 次下载。` +
      "条目由 Hugging Face 模型库自动汇总。";
    out.push(
      baseCandidate({
        key: `hf:${model.id}`,
        category: "model",
        title: `${vendor} 开源 ${displayName}`,
        titleEn: model.id,
        summary,
        summaryKind: "template",
        eventDate: date,
        organization: vendor,
        modelName: displayName,
        tags: ["开源", vendor],
        meta: {
          vendor,
          vendorKey: vendorKeyOf(vendorKey),
          openWeights: true,
          hfRepo: model.id,
          likes,
          downloads,
          trendingScore: model.trendingScore,
          pipelineTag: model.pipelineTag,
          familyKey: modelFamilyKey(model.id),
        },
        modelKey: modelKeyOf(model.id),
        familyKey: modelFamilyKey(model.id),
        aliases: modelAliasesOf(model.id),
        urls: [normalizeUrl(`https://huggingface.co/${model.id}`)],
        headLab: isHeadLab(vendorKey),
        hfLikes: likes,
        evidence: {
          sourceKey: "hf-trending",
          sourceFamily: "huggingface",
          sourceName: "Hugging Face",
          title: model.id,
          url: `https://huggingface.co/${model.id}`,
          publishedAt: model.createdAt,
          externalId: model.id,
        },
      })
    );
  }
  return out;
}

function arxivCandidates(payload) {
  const out = [];
  for (const paper of payload.items || []) {
    if (!paper.publishedAt) continue;
    if (!TOPIC_WORDS.test(paper.title)) continue;
    const date = isoDay(paper.publishedAt);
    const excerpt = cleanText(paper.summary, 240);
    out.push(
      baseCandidate({
        key: `arxiv:${paper.id}`,
        category: "research",
        title: paper.title,
        titleEn: paper.title,
        summary: `arXiv 论文：${paper.title}。${excerpt}`,
        summaryKind: "excerpt",
        eventDate: date,
        organization: "arXiv",
        tags: ["论文", "研究", ...extractTags(`${paper.title} ${paper.summary || ""}`)],
        meta: {
          arxivId: paper.id,
          categories: paper.categories,
          excerpt,
        },
        urls: [normalizeUrl(paper.url)],
        evidence: {
          sourceKey: "arxiv",
          sourceFamily: "arxiv",
          sourceName: "arXiv",
          title: paper.title,
          url: paper.url,
          publishedAt: paper.publishedAt,
          externalId: paper.externalId,
        },
      })
    );
  }
  return out;
}

function communityCandidates(payload) {
  const out = [];
  for (const hit of payload.items || []) {
    if (!hit.publishedAt) continue;
    const title = htmlToText(hit.title, 300);
    if (title.length < 12) continue;
    const category = classifyTitle(title, "", hit.url);
    const date = isoDay(hit.publishedAt);
    out.push(
      baseCandidate({
        key: `hn:${hit.id}`,
        category,
        title,
        summary: `Hacker News 社区讨论：${title}。发布时获得 ${hit.points} 分、${hit.comments} 条评论。`,
        summaryKind: "template",
        eventDate: date,
        organization: "Hacker News",
        tags: extractTags(title),
        meta: {
          hnPoints: hit.points,
          hnComments: hit.comments,
          hnLink: hit.hnLink,
          hnAuthor: hit.author,
        },
        urls: [normalizeUrl(hit.url)],
        hnPoints: hit.points,
        evidence: {
          sourceKey: "hn",
          sourceFamily: "community",
          sourceName: "Hacker News",
          title,
          url: hit.hnLink,
          publishedAt: hit.publishedAt,
          externalId: hit.externalId,
        },
      })
    );
  }
  return out;
}

function feedCandidates(payload, source) {
  const out = [];
  for (const item of payload.items || []) {
    if (!item.publishedAt) continue;
    const title = cleanText(item.title, 300);
    if (title.length < 12) continue;
    // Domestic general-tech feeds carry a lot of non-AI business news; the
    // headline must mention AI to enter the chronicle.
    if (source.aiOnly && !AI_RELEVANCE.test(title)) continue;
    const category = classifyTitle(title, item.summary, item.url);
    const date = isoDay(item.publishedAt);
    const sitemap = source.kind === "sitemap";
    const notableOfficial =
      source.family === "official" && !sitemap && isNotableOfficial(category, title);
    const summary = item.summary
      ? `来源摘录：${cleanText(item.summary, 320)}`
      : `${source.name} 发布的条目：「${title}」。原文请见证据链接。`;
    out.push(
      baseCandidate({
        key: `${source.key}:${item.externalId}`,
        category,
        title,
        titleEn: title,
        summary,
        summaryKind: item.summary ? "excerpt" : "template",
        eventDate: date,
        organization: source.name,
        tags: [
          ...(source.domestic ? ["国内"] : []),
          ...extractTags(`${title} ${item.summary || ""}`),
        ],
        meta: {
          feed: source.key,
          feedUrl: source.url,
        },
        urls: [normalizeUrl(item.url)],
        headLab: source.family === "official",
        officialPrimary: source.family === "official",
        mediaOnly: source.family === "media",
        domestic: Boolean(source.domestic),
        sitemap,
        notableOfficial,
        evidence: {
          sourceKey: source.key,
          sourceFamily: source.family,
          sourceName: source.name,
          title,
          url: item.url,
          publishedAt: item.publishedAt,
          externalId: item.externalId,
        },
      })
    );
  }
  return out;
}

/**
 * Turn parsed upstream payloads into uniform candidates.
 */
export function normalizeResults(results) {
  const candidates = [];
  const failed = [];
  for (const result of results) {
    if (!result.ok) {
      failed.push({ key: result.key, name: result.name, error: result.error, ms: result.ms });
      continue;
    }
    if (result.key === "openrouter") candidates.push(...openRouterCandidates(result));
    else if (result.key.startsWith("hf-")) candidates.push(...hfCandidates(result));
    else if (result.key === "arxiv") candidates.push(...arxivCandidates(result));
    else if (result.key.startsWith("hn-")) candidates.push(...communityCandidates(result));
    else {
      const source = {
        key: result.key,
        family: result.family,
        name: result.name,
        kind: result.kind || "",
        url: result.url || "",
        domestic: Boolean(result.domestic),
        aiOnly: Boolean(result.aiOnly),
      };
      candidates.push(...feedCandidates(result, source));
    }
  }
  return { candidates, failed };
}
