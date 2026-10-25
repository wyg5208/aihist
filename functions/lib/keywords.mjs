/**
 * Keyword vocabulary shared by ingestion and the read API.
 *
 * Every timeline entry should carry more than one meaningful keyword, so the
 * archive can be browsed by topic (开源、算法、机器人、脑机接口…) rather than
 * only by year or category. Labels are Chinese; proper nouns keep their
 * original spelling.
 */
const RULES = [
  ["大模型", /(?:^|[^A-Za-z])(?:llms?|large language models?|foundation models?)(?:[^A-Za-z]|$)|大模型|基础模型|语言模型|千亿参数|万亿参数/i],
  ["生成式 AI", /generative ai|genai|生成式|aigc|文生/i],
  ["开源", /open[- ]?sources?|open[- ]?weights?|开源|开放权重|开放模型|开放生态/i],
  ["闭源", /closed[- ]?(?:api|source|weights?)|闭源|闭源模型/i],
  ["推理", /reasoning|chain[- ]of[- ]thought|推理模型|思维链|推理能力|深度思考/i],
  ["智能体", /agentic|\bagents?\b|智能体|多智能体/i],
  ["多模态", /multimodal|multi-modal|多模态|视觉语言|vision[- ]language|全模态|omni/i],
  ["机器人", /robotics?|\brobots?\b|机器人|具身智能|具身|人形机器人|机械臂|四足/i],
  ["脑机接口", /brain[- ]computer|\bbci\b|脑机接口|神经接口|脑机/i],
  ["自动驾驶", /autonomous driving|self[- ]driving|robotaxi|\bfsd\b|自动驾驶|智能驾驶|智驾/i],
  ["世界模型", /world models?|世界模型/i],
  ["算法", /algorithm|算法|模型架构|架构创新|注意力机制|attention|transformer/i],
  ["训练", /training|预训练|pretrain|微调|fine[- ]?tun|强化学习|rlhf|rlvr|post[- ]?training|后训练|蒸馏/i],
  ["芯片", /chips?\b|\bgpus?\b|\btpus?\b|\basis\b|semiconductor|算力|半导体|晶圆|光刻|昇腾|寒武纪|摩尔线程|英伟达|nvidia/i],
  ["数据", /datasets?|training data|语料|数据标注|数据要素|数据质量|合成数据/i],
  ["评测", /benchmarks?|evaluation|基准|评测|测评|榜单|跑分/i],
  ["安全", /safety|alignment|guardrails?|安全|对齐|风险|越狱|红队/i],
  ["可解释性", /interpretab|explainab|可解释|可解释性|机制可解释/i],
  ["隐私", /privacy|隐私|数据保护/i],
  ["监管", /regulat|legislation|\bbill\b|policy|法案|法规|条例|政策|合规|备案|治理|标准|白皮书|指导意见|管理办法/i],
  ["伦理", /ethic|伦理|道德/i],
  ["医疗", /medical|healthcare|医疗|医学|药物|蛋白|生物|医院|临床/i],
  ["教育", /education|教育|教师|学生|课堂|校园/i],
  ["编程", /coding|copilot|software engineering|编程|代码生成|开发者|软件工程/i],
  ["科学", /scientific|science|物理|化学|数学|定理|证明|nature|诺贝尔|nobel/i],
  ["具身", /embodied|具身/i],
  ["语音", /speech|音频|语音|\btts\b|\basr\b|配音/i],
  ["图像生成", /image generation|text[- ]to[- ]image|文生图|图像生成|扩散模型|diffusion|midjourney|stable diffusion|dall/i],
  ["视频生成", /video generation|text[- ]to[- ]video|视频生成|文生视频|sora|\bveo\b|可灵/i],
  ["搜索", /search|搜索|检索增强|\brag\b/i],
  ["云计算", /cloud|数据中心|data cent(?:er|re)|云计算|算力中心|智算/i],
  ["终端", /smartphone|\bpc\b|wearable|手机|终端|可穿戴|智能眼镜|硬件|眼镜/i],
  ["融资", /funding|valuation|\bipo\b|acquisition|acquire|融资|估值|上市|收购|投资|参投/i],
  ["AGI", /\bagi\b|artificial general intelligence|通用人工智能|超级智能|superintelligence/i],
  ["人物", /interview|conversation with|profile|keynote|访谈|专访|人物|演讲|回忆录|诺奖|图灵奖|hinton|altman|lecun|fei[- ]fei li|李飞飞|黄仁勋|jensen huang|ilya sutskever|马斯克|musk|梁文锋|杨植麟|王小川|李彦宏|雷军|王坚/i],
  ["国内", /中国|国内|国产|中文|本土|阿里|百度|腾讯|字节|华为|智谱|月之暗面|deepseek|qwen|通义|文心|豆包|混元|kimi|minimax|阶跃|商汤|讯飞|百川|零一万物|面壁|无问芯穹|智元|宇树/i],
  ["技术", /technolog|技术|工程化|系统设计|基础设施|infra/i],
];

/** Older rows stored English slugs; map the meaningful ones, drop feed ids. */
const TAG_ALIASES = new Map([
  ["open-weights", "开源"],
  ["open-source", "开源"],
  ["closed-api", "闭源"],
  ["arxiv", "论文"],
  ["hacker-news", "社区讨论"],
  ["policy", "监管"],
  ["safety", "安全"],
  ["agents", "智能体"],
  ["reasoning", "推理"],
  ["multimodal", "多模态"],
  ["robotics", "机器人"],
  ["gpt", "GPT"],
  ["chatgpt", "ChatGPT"],
  ["claude", "Claude"],
  ["gemini", "Gemini"],
  ["llama", "Llama"],
  ["qwen", "Qwen"],
  ["deepseek", "DeepSeek"],
  ["mistral", "Mistral"],
  ["grok", "Grok"],
  ["kimi", "Kimi"],
  ["glm", "GLM"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google"],
  ["meta", "Meta"],
  ["nvidia", "NVIDIA"],
  ["minimax", "MiniMax"],
  ["zhipu", "智谱"],
  ["moonshotai", "月之暗面"],
  ["alibaba", "阿里"],
  ["tencent", "腾讯"],
  ["bytedance", "字节跳动"],
  ["stepfun", "阶跃星辰"],
  ["inclusionai", "无问芯穹"],
  ["xiaomi", "小米"],
  ["upstage", "Upstage"],
  ["cohere", "Cohere"],
  ["sakana", "Sakana AI"],
  // Curated seed tags were written as English slugs; map the topical ones so
  // the archive reads as a Chinese keyword index.
  ["standards", "标准"],
  ["security", "安全"],
  ["distillation", "蒸馏"],
  ["coding", "编程"],
  ["long-context", "长上下文"],
  ["video-generation", "视频生成"],
  ["image-generation", "图像生成"],
  ["partnership", "合作"],
  ["regulation", "监管"],
  ["ai-act", "AI 法案"],
  ["tools", "工具调用"],
  ["forecast", "预测"],
  ["scenario", "情景"],
  ["scaling-laws", "缩放定律"],
  ["scaling", "规模化"],
  ["infrastructure", "基础设施"],
  ["nobel", "诺奖"],
  ["biology", "生命科学"],
  ["neural-networks", "神经网络"],
  ["science", "科学"],
  ["realtime", "实时交互"],
  ["existential-risk", "生存风险"],
  ["statement", "声明"],
  ["open-letter", "公开信"],
  ["governance", "治理"],
  ["copyright", "版权"],
  ["alignment", "对齐"],
  ["chatbot", "聊天机器人"],
  ["milestone", "里程碑"],
  ["diffusion", "扩散模型"],
  ["ethics", "伦理"],
  ["developer-tools", "开发者工具"],
  ["few-shot", "少样本"],
  ["bitter-lesson", "苦涩教训"],
  ["opinion", "观点"],
  ["nlp", "自然语言处理"],
  ["pretraining", "预训练"],
  ["attention", "注意力机制"],
  ["deep-learning", "深度学习"],
  ["go", "围棋"],
  ["reinforcement-learning", "强化学习"],
  ["computer-vision", "计算机视觉"],
  ["seq2seq", "序列到序列"],
  ["machine-translation", "机器翻译"],
  ["generative-models", "生成模型"],
  ["embeddings", "词向量"],
  ["qa", "问答"],
  ["dataset", "数据集"],
  ["dbn", "深度置信网络"],
  ["ai-winter", "AI 寒冬"],
  ["ai-foundations", "学科奠基"],
  ["turing-test", "图灵测试"],
  ["philosophy", "哲学"],
  ["games", "棋类"],
  ["backpropagation", "反向传播"],
  ["perceptron", "感知机"],
  ["dartmouth", "达特茅斯会议"],
  ["deep-blue", "深蓝"],
  ["google-cloud", "Google Cloud"],
  ["ai-safety", "安全"],
]);

/**
 * Lowercase slugs that name a product, paper or model and should stay in
 * their original spelling. Any other bare lowercase slug is a stale tag and
 * is dropped in favour of inferred Chinese keywords.
 */
const KEEP_AS_IS = new Set([
  "o1",
  "o3",
  "bert",
  "sora",
  "clip",
  "alphago",
  "alphafold",
  "imagenet",
  "mnist",
  "lstm",
  "rnn",
  "cnn",
  "gan",
  "watson",
  "eliza",
  "chinchilla",
  "alexnet",
  "resnet",
  "word2vec",
  "moe",
  "rlhf",
  "instructgpt",
  "api",
  "agi",
  "us",
  "eu",
  "unesco",
  "codex",
  "copilot",
  "hinton",
  "claude-code",
  "stargate",
]);

const DROP_TAGS = new Set([
  "openrouter",
  "hf-trending",
  "hf-textgen",
  "hf-blog",
  "hn-llm",
  "hn-ai",
  "techcrunch",
  "verge",
  "mittr",
  "qbitai",
  "leiphone",
  "tmtpost",
  "infoq",
  "media",
  "official",
  "community",
  "openrouter-model",
  // Interface labels: they describe the pipe, not the topic.
  "媒体报道",
  "官方公告",
  "社区讨论",
  "来源摘录",
]);

const CATEGORY_KEYWORD = {
  milestone: "里程碑",
  model: "大模型",
  research: "研究",
  opinion: "观点",
  policy: "产业",
};

function tagLabel(tag) {
  if (typeof tag !== "string") return "";
  const value = tag.trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  if (DROP_TAGS.has(lower)) return "";
  if (TAG_ALIASES.has(lower)) return TAG_ALIASES.get(lower);
  // A bare lowercase word is an old machine slug ("coding", "security") rather
  // than a display keyword. Keep only recognized proper nouns.
  if (/^[a-z][a-z0-9.-]*$/.test(value) && !KEEP_AS_IS.has(lower)) return "";
  return value;
}

/** Infer keywords from free text, in rule order, without duplicates. */
export function keywordsFromText(text, limit = 8) {
  const value = String(text || "");
  if (!value.trim()) return [];
  const out = [];
  for (const [label, re] of RULES) {
    if (out.length >= limit) break;
    if (re.test(value)) out.push(label);
  }
  return out;
}

/**
 * Merge stored tags, inferred keywords and a category fallback so that every
 * entry exposes at least two keywords.
 */
export function keywordsFor(entry = {}, limit = 10) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const out = [];
  const push = (value) => {
    const label = tagLabel(value);
    if (label && !out.includes(label)) out.push(label);
  };
  for (const tag of tags) push(tag);

  const text = [
    entry.title,
    entry.titleEn,
    entry.summary,
    entry.organization,
    entry.modelName,
  ]
    .filter(Boolean)
    .join(" \n ");
  for (const label of keywordsFromText(text, limit)) push(label);

  if (out.length < 2) {
    const fallback = CATEGORY_KEYWORD[entry.category];
    if (fallback) push(fallback);
  }
  if (out.length < 2) push("人工智能");
  return out.slice(0, limit);
}

export const KEYWORD_LABELS = RULES.map(([label]) => label);
