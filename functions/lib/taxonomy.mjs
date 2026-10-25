/**
 * Vendor / model-series taxonomy shared by the read API.
 *
 * Timeline entries can be browsed by publisher lab (OpenAI、Anthropic、阿里云、
 * 智谱…) and by model family (GPT、Claude、Qwen、GLM…). The raw database keeps
 * free-text organisation and model names, so the labels are derived on read.
 */

const VENDOR_RULES = [
  ["OpenAI", /openai|open ai|chatgpt|dall[·-]?e|\bsora\b|\bcodex\b|\bgpt[-\s]?\d|\bo[1-9]\b/i],
  ["Anthropic", /anthropic|claude/i],
  ["Google", /google|deepmind|gemini|alphafold|imagen|\bveo\b|gemma|\bbard\b/i],
  ["Meta", /\bmeta\b|llama/i],
  ["xAI", /\bxai\b|\bx\.ai\b|\bgrok\b/i],
  ["GitHub", /github/i],
  ["Microsoft", /microsoft|微软|azure|\bphi-\d/i],
  ["Stability AI", /stability ai/i],
  ["NVIDIA", /nvidia|英伟达|nemotron|cuda/i],
  ["Mistral", /mistral|mixtral/i],
  ["Amazon", /amazon|亚马逊|\baws\b|\btitan\b/i],
  ["Apple", /\bapple\b|苹果公司/i],
  ["IBM", /\bibm\b|watson/i],
  ["阿里云", /阿里|阿里巴巴|alibaba|qwen|通义|千问|魔搭|modelscope/i],
  ["智谱", /智谱|zhipu|z\.ai|\bglm\b|chatglm|cogview|cogvideo/i],
  ["DeepSeek", /deepseek|深度求索/i],
  ["月之暗面", /月之暗面|moonshot|\bkimi\b/i],
  ["MiniMax", /minimax|海螺|hailuo/i],
  ["字节跳动", /字节|bytedance|doubao|豆包|seedream|seedance|即梦|火山引擎/i],
  ["腾讯", /腾讯|tencent|混元|hunyuan/i],
  ["百度", /百度|baidu|文心|ernie/i],
  ["华为", /华为|huawei|昇腾|ascend|盘古|pangu|鸿蒙|harmonyos/i],
  ["商汤", /商汤|sensetime|日日新|sensenova/i],
  ["科大讯飞", /讯飞|iflytek|星火/i],
  ["阶跃星辰", /阶跃|stepfun/i],
  ["零一万物", /零一万物|01\.ai|yi-large|yi-lightning/i],
  ["上海 AI 实验室", /上海人工智能实验室|shanghai ai lab|internlm|internvl|书生/i],
  ["智源", /智源|baai|flagos/i],
  ["智元", /智元|agibot/i],
  ["宇树", /宇树|unitree/i],
  ["Figure", /figure ai/i],
  ["Tesla", /tesla|特斯拉|optimus/i],
];

const SERIES_RULES = [
  ["GPT", /gpt[-\s]?\d|\bgpt\b|chatgpt|instructgpt/i],
  ["Claude", /claude/i],
  ["Gemini", /gemini/i],
  ["Llama", /llama/i],
  ["Qwen", /qwen|通义|千问/i],
  ["GLM", /\bglm\b|chatglm/i],
  ["DeepSeek", /deepseek/i],
  ["Kimi", /\bkimi\b/i],
  ["MiniMax", /minimax|\babab\b/i],
  ["Grok", /\bgrok\b/i],
  ["Mistral", /mistral|mixtral|codestral|pixtral/i],
  ["Hunyuan", /hunyuan|混元/i],
  ["ERNIE", /ernie|文心/i],
  ["Doubao", /doubao|豆包/i],
  ["Seed", /seedream|seedance|doubao[-\s]?seed|字节.*\bseed\b/i],
  ["Step", /stepfun|阶跃|step-\d/i],
  ["Yi", /yi-large|yi-lightning|yi-34b|01\.ai|零一万物/i],
  ["Baichuan", /baichuan|百川/i],
  ["InternLM", /internlm|internvl|书生|浦语/i],
  ["Gemma", /gemma/i],
  ["Phi", /\bphi-\d/i],
  ["Nemotron", /nemotron/i],
  ["Sora", /\bsora\b/i],
  ["Veo", /\bveo\b/i],
  ["Imagen", /imagen/i],
  ["DALL·E", /dall[·-]?e/i],
  ["CLIP", /\bclip\b/i],
  ["Stable Diffusion", /stable[-\s]diffusion/i],
  ["Copilot", /copilot/i],
  ["o 系列", /\bo[1-9](?:[-\s](?:mini|pro|preview))?\b/i],
  ["Muse", /\bmuse\b/i],
];

/** First rule whose text appears earliest wins, so a headline's subject wins. */
function matchRule(text, rules) {
  let best = null;
  for (const [label, re] of rules) {
    const found = re.exec(text);
    if (!found) continue;
    if (!best || found.index < best.index) best = { label, index: found.index };
  }
  return best?.label || null;
}

/**
 * Canonical lab / company label. Organisation wins over headline text because
 * an article title may name several companies.
 */
export function vendorFor(entry = {}) {
  for (const field of [entry.organization, entry.modelName, entry.titleEn, entry.title]) {
    if (typeof field !== "string" || !field.trim()) continue;
    const label = matchRule(field, VENDOR_RULES);
    if (label) return label;
  }
  const tags = Array.isArray(entry.tags) ? entry.tags.join(" ") : "";
  const fromTags = matchRule(tags, VENDOR_RULES);
  if (fromTags) return fromTags;
  // Long-tail model publishers still get a vendor label so the filter covers
  // everything the model directory contributes.
  if (entry.category === "model" && typeof entry.organization === "string") {
    const organization = entry.organization.trim();
    if (organization) return organization;
  }
  return null;
}

/** Canonical model-family label, e.g. Qwen / GLM / GPT / Claude. */
export function seriesFor(entry = {}) {
  for (const field of [entry.modelName, entry.titleEn, entry.title, entry.organization]) {
    if (typeof field !== "string" || !field.trim()) continue;
    const label = matchRule(field, SERIES_RULES);
    if (label) return label;
  }
  const tags = Array.isArray(entry.tags) ? entry.tags.join(" ") : "";
  const fromTags = matchRule(tags, SERIES_RULES);
  if (fromTags) return fromTags;
  if (entry.category === "model" && typeof entry.modelName === "string") {
    const modelName = entry.modelName.trim();
    if (modelName) return modelName;
  }
  return null;
}

