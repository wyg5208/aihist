/**
 * Coverage benchmark: entries that a serious AI chronicle should contain.
 *
 * This is a test fixture, never seeded into the database. Each entry describes
 * a verifiable public milestone and only carries the minimum needed to find it:
 * distinctive Latin tokens, model keys, or one unique phrase. Notes explain the
 * expectation; they are not stored article text.
 *
 * Gaps are intentional: an entry that cannot be found in the archive is the
 * point of the measurement, not an error in this file.
 */

const b = (id, year, category, importance, def) => ({
  id,
  year,
  category,
  importance,
  vendor: def.vendor || null,
  tokens: def.tokens || [],
  keys: def.keys || [],
  phrase: def.phrase || "",
  note: def.note,
});

export const BENCHMARK = [
  // Pre-history and symbolic AI
  b("el-ajedrecista-1912", 1912, "milestone", 50, {
    phrase: "Ajedrecista",
    note: "Torres Quevedo 的国际象棋自动机",
  }),
  b("rur-1920", 1920, "milestone", 48, {
    phrase: "R.U.R.",
    note: "恰佩克戏剧让 robot 进入现代语汇",
  }),
  b("godel-1931", 1931, "research", 62, {
    phrase: "unentscheidbare",
    note: "哥德尔不完备定理",
  }),
  b("mcculloch-pitts-1943", 1943, "research", 76, {
    tokens: ["logical", "nervous"],
    note: "形式神经元模型",
  }),
  b("hebb-1949", 1949, "research", 66, {
    tokens: ["organization", "behavior"],
    note: "赫布学习规则",
  }),
  b("turing-1950", 1950, "research", 94, {
    tokens: ["computing", "machinery"],
    note: "《计算机器与智能》提出模仿游戏",
  }),
  b("dartmouth-1956", 1956, "milestone", 96, {
    tokens: ["dartmouth", "summer"],
    note: "达特茅斯会议，人工智能得名",
  }),
  b("logic-theorist-1956", 1956, "research", 74, {
    tokens: ["logic", "theorist"],
    note: "首个自动定理证明程序",
  }),
  b("perceptron-1958", 1958, "research", 84, {
    tokens: ["perceptron", "probabilistic"],
    note: "Rosenblatt 感知机",
  }),
  b("lisp-1958", 1958, "research", 70, {
    phrase: "Lisp",
    note: "McCarthy 设计 Lisp",
  }),
  b("unimate-1961", 1961, "milestone", 64, {
    phrase: "Unimate",
    note: "工业机器人进入通用汽车产线",
  }),
  b("dendral-1965", 1965, "research", 60, {
    phrase: "Dendral",
    note: "专家系统路线成形",
  }),
  b("fuzzy-sets-1965", 1965, "research", 66, {
    tokens: ["fuzzy", "sets"],
    note: "Zadeh 模糊集合",
  }),
  b("eliza-1966", 1966, "research", 80, {
    phrase: "ELIZA",
    note: "最早的人机对话程序之一",
  }),
  b("perceptrons-1969", 1969, "research", 76, {
    tokens: ["perceptrons", "computational"],
    note: "《Perceptrons》指出单层网络局限",
  }),
  b("shakey-1969", 1969, "research", 62, {
    phrase: "Shakey",
    note: "能感知、规划并行动的移动机器人",
  }),
  b("shrdlu-1971", 1971, "research", 62, {
    phrase: "SHRDLU",
    note: "积木世界中的自然语言理解",
  }),
  b("prolog-1972", 1972, "research", 60, {
    phrase: "Prolog",
    note: "逻辑编程语言登场",
  }),
  b("lighthill-report-1973", 1973, "policy", 66, {
    phrase: "Lighthill",
    note: "报告引发英国 AI 经费收缩",
  }),
  b("mycin-1974", 1974, "research", 62, {
    phrase: "MYCIN",
    note: "医学专家系统",
  }),
  b("simon-nobel-1978", 1978, "milestone", 64, {
    tokens: ["herbert", "simon"],
    note: "西蒙获诺贝尔经济学奖",
  }),
  b("xcon-1980", 1980, "milestone", 58, {
    phrase: "XCON",
    note: "DEC 的配置专家系统实现大规模商用",
  }),
  b("fifth-generation-1982", 1982, "policy", 62, {
    tokens: ["fifth", "generation"],
    note: "日本第五代计算机计划",
  }),
  b("backprop-1986", 1986, "research", 88, {
    tokens: ["representations", "propagating"],
    note: "反向传播论文登上 Nature",
  }),
  b("brooks-subsumption-1987", 1987, "research", 60, {
    tokens: ["robust", "layered"],
    note: "Brooks 包容架构",
  }),
  b("lenet-1989", 1989, "research", 80, {
    tokens: ["backpropagation", "handwritten"],
    note: "LeCun 卷积网络识别手写数字",
  }),
  b("td-gammon-1992", 1992, "research", 58, {
    phrase: "TD-Gammon",
    note: "神经网络 + 强化学习达到西洋双陆棋顶尖",
  }),
  b("deep-blue-1997", 1997, "milestone", 90, {
    tokens: ["deep", "blue"],
    note: "深蓝战胜卡斯帕罗夫",
  }),
  b("lstm-1997", 1997, "research", 84, {
    tokens: ["long", "short"],
    note: "LSTM 门控长序列记忆",
  }),
  b("lenet5-1998", 1998, "research", 78, {
    tokens: ["gradient", "document"],
    note: "LeNet-5 与 MNIST 训练范式",
  }),
  b("roomba-2002", 2002, "milestone", 52, {
    phrase: "Roomba",
    note: "消费级机器人进入家庭",
  }),
  b("dbn-2006", 2006, "research", 80, {
    tokens: ["深度", "信念"],
    note: "深度信念网络推动深度学习复兴",
  }),
  b("imagenet-2009", 2009, "research", 82, {
    tokens: ["imagenet", "hierarchical"],
    note: "ImageNet 数据集论文",
  }),
  b("watson-2011", 2011, "milestone", 78, {
    tokens: ["watson", "jeopardy"],
    note: "IBM Watson 赢得《Jeopardy!》",
    vendor: "IBM",
  }),
  b("siri-2011", 2011, "milestone", 66, {
    phrase: "Siri",
    note: "语音助手进入大众市场",
    vendor: "Apple",
  }),
  b("alexnet-2012", 2012, "research", 94, {
    tokens: ["imagenet", "classification"],
    note: "AlexNet 赢得 ImageNet",
  }),
  b("word2vec-2013", 2013, "research", 82, {
    tokens: ["word", "representations"],
    note: "词向量进入连续空间",
    vendor: "Google",
  }),
  b("gan-2014", 2014, "research", 86, {
    tokens: ["generative", "adversarial"],
    note: "生成对抗网络提出",
  }),
  b("seq2seq-2014", 2014, "research", 82, {
    tokens: ["sequence", "learning"],
    note: "端到端序列到序列翻译",
    vendor: "Google",
  }),
  b("resnet-2015", 2015, "research", 84, {
    tokens: ["residual", "recognition"],
    note: "ResNet 残差学习",
    vendor: "Microsoft",
  }),
  b("dqn-2015", 2015, "research", 86, {
    phrase: "deep reinforcement learning",
    note: "DQN 从像素学会 Atari 控制策略",
    vendor: "Google",
  }),
  b("alphago-2016", 2016, "research", 92, {
    tokens: ["mastering", "neural"],
    note: "AlphaGo 登上 Nature",
    vendor: "Google",
  }),
  b("alphago-match-2016", 2016, "milestone", 94, {
    tokens: ["alphago", "sedol"],
    note: "AlphaGo 4:1 战胜李世石",
    vendor: "Google",
  }),
  b("transformer-2017", 2017, "research", 98, {
    tokens: ["attention", "need"],
    note: "《Attention Is All You Need》",
    vendor: "Google",
  }),
  b("alphago-zero-2017", 2017, "research", 78, {
    tokens: ["alphago", "zero"],
    note: "AlphaGo Zero 从零自我对弈",
    vendor: "Google",
  }),
  b("gpt-1-2018", 2018, "model", 86, {
    phrase: "GPT-1",
    note: "生成式预训练路线验证",
    vendor: "OpenAI",
  }),
  b("bert-2018", 2018, "research", 91, {
    tokens: ["bert", "bidirectional"],
    note: "双向预训练刷新 NLP 基准",
    vendor: "Google",
  }),
  b("turing-award-2018", 2018, "milestone", 70, {
    phrase: "Turing Award",
    note: "Bengio、Hinton、LeCun 获图灵奖",
  }),
  b("gpt-2-2019", 2019, "model", 88, {
    phrase: "GPT-2",
    note: "分阶段开放引发安全争论",
    vendor: "OpenAI",
  }),
  b("bitter-lesson-2019", 2019, "opinion", 70, {
    tokens: ["bitter", "lesson"],
    note: "Sutton 提出通用方法终将胜出",
  }),
  b("alphastar-2019", 2019, "research", 66, {
    phrase: "AlphaStar",
    note: "星际争霸 II 达到宗师水平",
    vendor: "Google",
  }),

  // Foundation models and the generative wave
  b("gpt-3-2020", 2020, "model", 96, {
    phrase: "GPT-3",
    note: "少样本上下文学习成为通用能力",
    vendor: "OpenAI",
  }),
  b("alphafold2-2020", 2020, "research", 95, {
    tokens: ["alphafold", "casp14"],
    note: "CASP14 蛋白质结构预测突破",
    vendor: "Google",
  }),
  b("vit-2020", 2020, "research", 78, {
    phrase: "Vision Transformer",
    note: "ViT 把纯 Transformer 用于图像",
    vendor: "Google",
  }),
  b("clip-dalle-2021", 2021, "model", 88, {
    tokens: ["dall", "clip"],
    note: "CLIP 与 DALL·E 图文联合嵌入",
    vendor: "OpenAI",
  }),
  b("copilot-2021", 2021, "model", 80, {
    tokens: ["github", "copilot"],
    note: "AI 编程助手进入主流",
    vendor: "GitHub",
  }),
  b("lora-2021", 2021, "research", 76, {
    phrase: "LoRA",
    note: "低秩适配降低微调成本",
    vendor: "Microsoft",
  }),
  b("unesco-2021", 2021, "policy", 72, {
    tokens: ["recommendation", "ethics"],
    note: "首个全球 AI 伦理建议书",
  }),
  b("chatgpt-2022", 2022, "milestone", 99, {
    phrase: "ChatGPT",
    note: "生成式 AI 进入大众市场",
    vendor: "OpenAI",
  }),
  b("instructgpt-2022", 2022, "research", 86, {
    phrase: "InstructGPT",
    note: "RLHF 让模型更好遵循指令",
    vendor: "OpenAI",
  }),
  b("chinchilla-2022", 2022, "research", 83, {
    tokens: ["compute", "optimal"],
    note: "缩放定律修正参数与数据配比",
    vendor: "Google",
  }),
  b("dalle2-2022", 2022, "model", 82, {
    phrase: "DALL·E 2",
    note: "扩散模型改写图像生成",
    vendor: "OpenAI",
  }),
  b("stable-diffusion-2022", 2022, "model", 90, {
    tokens: ["stable", "diffusion"],
    note: "开源图像生成进入消费级显卡",
    vendor: "Stability AI",
  }),
  b("palm-2022", 2022, "model", 72, {
    phrase: "PaLM",
    note: "Pathways 语言模型 540B",
    vendor: "Google",
  }),
  b("whisper-2022", 2022, "model", 70, {
    phrase: "Whisper",
    note: "开放语音识别模型",
    vendor: "OpenAI",
  }),
  b("llama-2023", 2023, "model", 91, {
    keys: ["llama"],
    note: "开源大模型浪潮开启",
    vendor: "Meta",
  }),
  b("gpt-4-2023", 2023, "model", 97, {
    keys: ["gpt-4"],
    note: "GPT-4 支持图像输入",
    vendor: "OpenAI",
  }),
  b("claude-2023", 2023, "model", 89, {
    keys: ["claude"],
    note: "宪法式 AI 对齐路线",
    vendor: "Anthropic",
  }),
  b("mistral-7b-2023", 2023, "model", 80, {
    keys: ["mistral-7b"],
    note: "欧洲开源模型进入主流",
    vendor: "Mistral",
  }),
  b("gemini-1-2023", 2023, "model", 91, {
    keys: ["gemini-1.0"],
    note: "原生多模态全线接入",
    vendor: "Google",
  }),
  b("us-ai-eo-2023", 2023, "policy", 82, {
    tokens: ["executive", "order"],
    note: "美国首份综合性 AI 行政令",
  }),
  b("eu-ai-act-deal-2023", 2023, "policy", 80, {
    tokens: ["deal", "trustworthy"],
    note: "欧盟 AI 法案达成政治协议",
  }),
  b("china-genai-rules-2023", 2023, "policy", 84, {
    phrase: "生成式人工智能服务管理暂行办法",
    note: "中国生成式 AI 服务管理规则",
  }),
  b("pause-letter-2023", 2023, "opinion", 78, {
    tokens: ["pause", "giant"],
    note: "暂停巨型 AI 实验公开信",
  }),
  b("ai-risk-statement-2023", 2023, "opinion", 74, {
    tokens: ["statement", "risk"],
    note: "AI 灭绝风险声明",
  }),
  b("bletchley-2023", 2023, "policy", 72, {
    phrase: "Bletchley",
    note: "布莱切利园 AI 安全峰会",
  }),
  b("llama-2-2023", 2023, "model", 82, {
    keys: ["llama-2"],
    note: "Llama 2 开放商用许可",
    vendor: "Meta",
  }),
  b("mixtral-2023", 2023, "model", 78, {
    phrase: "Mixtral",
    note: "Mixtral 8x7B 稀疏 MoE",
    vendor: "Mistral",
  }),
  b("nist-ai-rmf-2023", 2023, "policy", 70, {
    phrase: "AI RMF",
    note: "NIST AI 风险管理框架",
  }),
  b("sora-2024", 2024, "model", 84, {
    keys: ["sora"],
    note: "文生视频进入分钟级",
    vendor: "OpenAI",
  }),
  b("claude-3-2024", 2024, "model", 86, {
    keys: ["claude-3"],
    note: "Claude 3 系列",
    vendor: "Anthropic",
  }),
  b("eu-ai-act-adopted-2024", 2024, "policy", 90, {
    tokens: ["meps", "landmark"],
    note: "欧洲议会通过 AI 法案",
  }),
  b("llama-3-2024", 2024, "model", 89, {
    keys: ["llama-3"],
    note: "开源模型逼近前沿",
    vendor: "Meta",
  }),
  b("gpt-4o-2024", 2024, "model", 94, {
    keys: ["gpt-4o"],
    note: "实时多模态交互成为默认",
    vendor: "OpenAI",
  }),
  b("o1-2024", 2024, "model", 90, {
    keys: ["o1"],
    note: "推理模型成为新品类",
    vendor: "OpenAI",
  }),
  b("alphafold3-2024", 2024, "research", 91, {
    tokens: ["alphafold", "molecules"],
    note: "结构预测扩展到分子复合体",
    vendor: "Google",
  }),
  b("nobel-physics-2024", 2024, "research", 86, {
    tokens: ["nobel", "physics"],
    note: "Hopfield 与 Hinton 获诺贝尔物理学奖",
  }),
  b("nobel-chemistry-2024", 2024, "research", 84, {
    tokens: ["nobel", "chemistry"],
    note: "蛋白质设计与结构预测获诺贝尔化学奖",
  }),
  b("gemini-2-2024", 2024, "model", 86, {
    keys: ["gemini-2.0"],
    note: "主打智能体与原生多模态",
    vendor: "Google",
  }),
  b("deepseek-v3-2024", 2024, "model", 88, {
    keys: ["deepseek-v3"],
    note: "低成本 MoE 进入前沿",
    vendor: "DeepSeek",
  }),
  b("gemini-1-5-2024", 2024, "model", 82, {
    keys: ["gemini-1.5"],
    note: "百万 token 上下文",
    vendor: "Google",
  }),
  b("qwen2-5-2024", 2024, "model", 80, {
    keys: ["qwen2.5"],
    note: "Qwen2.5 全尺寸开源家族",
    vendor: "阿里云",
  }),
  b("deepseek-v2-2024", 2024, "model", 78, {
    keys: ["deepseek-v2"],
    note: "MLA 与低成本推理",
    vendor: "DeepSeek",
  }),
  b("doubao-2024", 2024, "model", 70, {
    phrase: "豆包",
    note: "字节跳动豆包大模型进入价格战",
    vendor: "字节跳动",
  }),

  // Current generation
  b("deepseek-r1-2025", 2025, "model", 95, {
    keys: ["deepseek-r1"],
    note: "开放权重推理模型接近闭源前沿",
    vendor: "DeepSeek",
  }),
  b("claude-3-7-2025", 2025, "model", 87, {
    keys: ["claude-3.7-sonnet"],
    note: "扩展思考进入商用模型",
    vendor: "Anthropic",
  }),
  b("gpt-4-5-2025", 2025, "model", 87, {
    keys: ["gpt-4.5"],
    note: "非推理旗舰的收官之作",
    vendor: "OpenAI",
  }),
  b("gemini-2-5-pro-2025", 2025, "model", 90, {
    keys: ["gemini-2.5-pro"],
    note: "长上下文与思考能力领先",
    vendor: "Google",
  }),
  b("llama-4-2025", 2025, "model", 86, {
    keys: ["llama-4"],
    note: "MoE 与原生多模态",
    vendor: "Meta",
  }),
  b("o3-2025", 2025, "model", 87, {
    keys: ["o3"],
    note: "推理模型进入工具化阶段",
    vendor: "OpenAI",
  }),
  b("qwen3-2025", 2025, "model", 88, {
    keys: ["qwen3"],
    note: "覆盖密集与 MoE 全家族",
    vendor: "阿里云",
  }),
  b("claude-4-2025", 2025, "model", 91, {
    keys: ["claude-4"],
    note: "长时程编码与智能体能力",
    vendor: "Anthropic",
  }),
  b("gpt-5-2025", 2025, "model", 96, {
    keys: ["gpt-5"],
    note: "统一快速回答与深度推理",
    vendor: "OpenAI",
  }),
  b("gpt-5-1-2025", 2025, "model", 85, {
    keys: ["gpt-5.1"],
    note: "改进指令遵循与自适应推理",
    vendor: "OpenAI",
  }),
  b("gemini-3-2025", 2025, "model", 95, {
    keys: ["gemini-3"],
    note: "推理与智能体能力升级",
    vendor: "Google",
  }),
  b("claude-opus-4-5-2025", 2025, "model", 90, {
    keys: ["claude-opus-4.5"],
    note: "编码与长任务能力提升",
    vendor: "Anthropic",
  }),
  b("gpt-5-2-2025", 2025, "model", 86, {
    keys: ["gpt-5.2"],
    note: "专业工作能力继续提升",
    vendor: "OpenAI",
  }),
  b("kimi-k2-2025", 2025, "model", 82, {
    keys: ["kimi-k2"],
    note: "万亿参数 MoE 开源",
    vendor: "月之暗面",
  }),
  b("minimax-m2-2025", 2025, "model", 78, {
    keys: ["minimax-m2"],
    note: "面向智能体与编码优化",
    vendor: "MiniMax",
  }),
  b("gemini-3-1-2026", 2026, "model", 85, {
    keys: ["gemini-3.1-pro"],
    note: "Gemini 3.1 Pro 预览版",
    vendor: "Google",
  }),
  b("gpt-5-4-2026", 2026, "model", 86, {
    keys: ["gpt-5.4"],
    note: "GPT-5.4",
    vendor: "OpenAI",
  }),
  b("deepseek-v4-2026", 2026, "model", 88, {
    keys: ["deepseek-v4-pro"],
    note: "Flash 与 Pro 双规格",
    vendor: "DeepSeek",
  }),
  b("gpt-5-5-2026", 2026, "model", 88, {
    keys: ["gpt-5.5"],
    note: "GPT-5.5",
    vendor: "OpenAI",
  }),
  b("claude-sonnet-5-2026", 2026, "model", 86, {
    keys: ["claude-sonnet-5"],
    note: "Claude Sonnet 5",
    vendor: "Anthropic",
  }),
  b("gpt-5-6-2026", 2026, "model", 86, {
    keys: ["gpt-5.6-sol"],
    note: "GPT-5.6 系列",
    vendor: "OpenAI",
  }),
  b("claude-opus-5-2026", 2026, "model", 89, {
    keys: ["claude-opus-5"],
    note: "Claude Opus 5",
    vendor: "Anthropic",
  }),
  b("muse-2026", 2026, "model", 85, {
    keys: ["muse-spark-open"],
    note: "Meta 开源多模态模型",
    vendor: "Meta",
  }),
  b("gpt-6-astra-2026", 2026, "model", 92, {
    keys: ["gpt-6-astra"],
    note: "GPT-6 Astra",
    vendor: "OpenAI",
  }),
  b("gpt-6-2026", 2026, "model", 96, {
    keys: ["gpt-6-sol"],
    note: "GPT-6 Sol 与 Luna",
    vendor: "OpenAI",
  }),
  b("claude-opus-5-5-2026", 2026, "model", 89, {
    keys: ["claude-opus-5.5"],
    note: "Claude Opus 5.5",
    vendor: "Anthropic",
  }),
  b("claude-sonnet-5-5-2026", 2026, "model", 85, {
    keys: ["claude-sonnet-5.5"],
    note: "Claude Sonnet 5.5",
    vendor: "Anthropic",
  }),
  b("gpt-6-1-2026", 2026, "model", 88, {
    keys: ["gpt-6.1-sol"],
    note: "GPT-6.1 Sol",
    vendor: "OpenAI",
  }),
  b("gemini-4-argon-2026", 2026, "model", 94, {
    keys: ["gemini-4-argon"],
    note: "Gemini 4 Argon",
    vendor: "Google",
  }),

  // Chinese open-weight and platform lines
  b("chatglm-6b-2023", 2023, "model", 74, {
    keys: ["chatglm-6b"],
    note: "智谱与清华开源 ChatGLM-6B",
    vendor: "智谱",
  }),
  b("glm-4-2024", 2024, "model", 79, {
    keys: ["glm-4"],
    note: "GLM-4 中文能力对标 GPT-4",
    vendor: "智谱",
  }),
  b("glm-4-5-2025", 2025, "model", 82, {
    keys: ["glm-4.5"],
    note: "统一推理、编码与智能体",
    vendor: "智谱",
  }),
  b("glm-5-2026", 2026, "model", 80, {
    keys: ["glm-5"],
    note: "强化推理与智能体能力",
    vendor: "智谱",
  }),

  // Agent lineage and classic machine learning (2026-10-29 audit)
  b("q-learning-1992", 1992, "research", 82, {
    phrase: "Q-learning",
    note: "Watkins 与 Dayan 提出无模型强化学习控制方法",
  }),
  b("random-forest-2001", 2001, "research", 80, {
    phrase: "随机森林",
    note: "Breiman 提出随机森林，集成学习的经典方法",
  }),
  b("vae-2013", 2013, "research", 84, {
    phrase: "变分自编码器",
    note: "VAE 为深度生成模型提供概率框架",
  }),
  b("gcn-2016", 2016, "research", 82, {
    phrase: "图卷积网络",
    note: "GCN 把卷积推广到图结构数据",
  }),
  b("scaling-laws-2020", 2020, "research", 90, {
    phrase: "Scaling Laws",
    note: "OpenAI 提出语言模型的规模化法则",
  }),
  b("ddpm-2020", 2020, "research", 88, {
    phrase: "DDPM",
    note: "去噪扩散概率模型成为生成模型主线",
  }),
  b("react-2022", 2022, "research", 82, {
    phrase: "推理—行动",
    note: "ReAct 确立“思考—行动—观察”的智能体循环",
  }),
  b("autogpt-2023", 2023, "milestone", 85, {
    phrase: "AutoGPT",
    note: "首个现象级开源自主智能体",
  }),
  b("mcp-2024", 2024, "milestone", 88, {
    phrase: "Model Context Protocol",
    note: "MCP 统一模型与工具、数据的连接",
  }),
  b("manus-2025", 2025, "milestone", 88, {
    phrase: "Manus 发布",
    note: "通用智能体首次现象级出圈",
  }),
  b("claude-code-2025", 2025, "milestone", 85, {
    phrase: "终端编程智能体",
    note: "Claude Code 正式可用，终端成为 Agent 宿主",
  }),
  b("openclaw-2026", 2026, "milestone", 86, {
    phrase: "OpenClaw",
    note: "个人智能体进入本地部署与开源生态",
  }),
  b("workbuddy-2026", 2026, "milestone", 84, {
    phrase: "WorkBuddy",
    note: "腾讯桌面办公智能体进入规模化使用",
  }),
  b("muse-agent-2026", 2026, "milestone", 86, {
    phrase: "个人智能体 Muse",
    note: "Meta 把 Personal AI Agent 做成消费级产品",
  }),
];
