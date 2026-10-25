r"""Keyword vocabulary, ported from functions/lib/keywords.mjs.

Every pattern is compiled with re.ASCII so `\b` / `\w` behave like JavaScript's
ASCII-only definitions. Without it a pattern such as `\bagents?\b` fails on
"智能体agents" and the keyword list silently diverges.
"""

from __future__ import annotations

import re

from app.ingest.regexes import compile_ascii

RULES: list[tuple[str, re.Pattern[str]]] = [
    ("大模型", compile_ascii(r"(?:^|[^A-Za-z])(?:llms?|large language models?|foundation models?)(?:[^A-Za-z]|$)|大模型|基础模型|语言模型|千亿参数|万亿参数", re.I)),
    ("生成式 AI", compile_ascii(r"generative ai|genai|生成式|aigc|文生", re.I)),
    ("开源", compile_ascii(r"open[- ]?sources?|open[- ]?weights?|开源|开放权重|开放模型|开放生态", re.I)),
    ("闭源", compile_ascii(r"closed[- ]?(?:api|source|weights?)|闭源|闭源模型", re.I)),
    ("推理", compile_ascii(r"reasoning|chain[- ]of[- ]thought|推理模型|思维链|推理能力|深度思考", re.I)),
    ("智能体", compile_ascii(r"agentic|\bagents?\b|智能体|多智能体", re.I)),
    ("多模态", compile_ascii(r"multimodal|multi-modal|多模态|视觉语言|vision[- ]language|全模态|omni", re.I)),
    ("机器人", compile_ascii(r"robotics?|\brobots?\b|机器人|具身智能|具身|人形机器人|机械臂|四足", re.I)),
    ("脑机接口", compile_ascii(r"brain[- ]computer|\bbci\b|脑机接口|神经接口|脑机", re.I)),
    ("自动驾驶", compile_ascii(r"autonomous driving|self[- ]driving|robotaxi|\bfsd\b|自动驾驶|智能驾驶|智驾", re.I)),
    ("世界模型", compile_ascii(r"world models?|世界模型", re.I)),
    ("算法", compile_ascii(r"algorithm|算法|模型架构|架构创新|注意力机制|attention|transformer", re.I)),
    ("训练", compile_ascii(r"training|预训练|pretrain|微调|fine[- ]?tun|强化学习|rlhf|rlvr|post[- ]?training|后训练|蒸馏", re.I)),
    ("芯片", compile_ascii(r"chips?\b|\bgpus?\b|\btpus?\b|\basis\b|semiconductor|算力|半导体|晶圆|光刻|昇腾|寒武纪|摩尔线程|英伟达|nvidia", re.I)),
    ("数据", compile_ascii(r"datasets?|training data|语料|数据标注|数据要素|数据质量|合成数据", re.I)),
    ("评测", compile_ascii(r"benchmarks?|evaluation|基准|评测|测评|榜单|跑分", re.I)),
    ("安全", compile_ascii(r"safety|alignment|guardrails?|安全|对齐|风险|越狱|红队", re.I)),
    ("可解释性", compile_ascii(r"interpretab|explainab|可解释|可解释性|机制可解释", re.I)),
    ("隐私", compile_ascii(r"privacy|隐私|数据保护", re.I)),
    ("监管", compile_ascii(r"regulat|legislation|\bbill\b|policy|法案|法规|条例|政策|合规|备案|治理|标准|白皮书|指导意见|管理办法", re.I)),
    ("伦理", compile_ascii(r"ethic|伦理|道德", re.I)),
    ("医疗", compile_ascii(r"medical|healthcare|医疗|医学|药物|蛋白|生物|医院|临床", re.I)),
    ("教育", compile_ascii(r"education|教育|教师|学生|课堂|校园", re.I)),
    ("编程", compile_ascii(r"coding|copilot|software engineering|编程|代码生成|开发者|软件工程", re.I)),
    ("科学", compile_ascii(r"scientific|science|物理|化学|数学|定理|证明|nature|诺贝尔|nobel", re.I)),
    ("具身", compile_ascii(r"embodied|具身", re.I)),
    ("语音", compile_ascii(r"speech|音频|语音|\btts\b|\basr\b|配音", re.I)),
    ("图像生成", compile_ascii(r"image generation|text[- ]to[- ]image|文生图|图像生成|扩散模型|diffusion|midjourney|stable diffusion|dall", re.I)),
    ("视频生成", compile_ascii(r"video generation|text[- ]to[- ]video|视频生成|文生视频|sora|\bveo\b|可灵", re.I)),
    ("搜索", compile_ascii(r"search|搜索|检索增强|\brag\b", re.I)),
    ("云计算", compile_ascii(r"cloud|数据中心|data cent(?:er|re)|云计算|算力中心|智算", re.I)),
    ("终端", compile_ascii(r"smartphone|\bpc\b|wearable|手机|终端|可穿戴|智能眼镜|硬件|眼镜", re.I)),
    ("融资", compile_ascii(r"funding|valuation|\bipo\b|acquisition|acquire|融资|估值|上市|收购|投资|参投", re.I)),
    ("AGI", compile_ascii(r"\bagi\b|artificial general intelligence|通用人工智能|超级智能|superintelligence", re.I)),
    ("人物", compile_ascii(r"interview|conversation with|profile|keynote|访谈|专访|人物|演讲|回忆录|诺奖|图灵奖|hinton|altman|lecun|fei[- ]fei li|李飞飞|黄仁勋|jensen huang|ilya sutskever|马斯克|musk|梁文锋|杨植麟|王小川|李彦宏|雷军|王坚", re.I)),
    ("国内", compile_ascii(r"中国|国内|国产|中文|本土|阿里|百度|腾讯|字节|华为|智谱|月之暗面|deepseek|qwen|通义|文心|豆包|混元|kimi|minimax|阶跃|商汤|讯飞|百川|零一万物|面壁|无问芯穹|智元|宇树", re.I)),
    ("技术", compile_ascii(r"technolog|技术|工程化|系统设计|基础设施|infra", re.I)),
]

TAG_ALIASES: dict[str, str] = {
    "open-weights": "开源",
    "open-source": "开源",
    "closed-api": "闭源",
    "arxiv": "论文",
    "hacker-news": "社区讨论",
    "policy": "监管",
    "safety": "安全",
    "agents": "智能体",
    "reasoning": "推理",
    "multimodal": "多模态",
    "robotics": "机器人",
    "gpt": "GPT",
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "gemini": "Gemini",
    "llama": "Llama",
    "qwen": "Qwen",
    "deepseek": "DeepSeek",
    "mistral": "Mistral",
    "grok": "Grok",
    "kimi": "Kimi",
    "glm": "GLM",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
    "meta": "Meta",
    "nvidia": "NVIDIA",
    "minimax": "MiniMax",
    "zhipu": "智谱",
    "moonshotai": "月之暗面",
    "alibaba": "阿里",
    "tencent": "腾讯",
    "bytedance": "字节跳动",
    "stepfun": "阶跃星辰",
    "inclusionai": "无问芯穹",
    "xiaomi": "小米",
    "upstage": "Upstage",
    "cohere": "Cohere",
    "sakana": "Sakana AI",
    "standards": "标准",
    "security": "安全",
    "distillation": "蒸馏",
    "coding": "编程",
    "long-context": "长上下文",
    "video-generation": "视频生成",
    "image-generation": "图像生成",
    "partnership": "合作",
    "regulation": "监管",
    "ai-act": "AI 法案",
    "tools": "工具调用",
    "forecast": "预测",
    "scenario": "情景",
    "scaling-laws": "缩放定律",
    "scaling": "规模化",
    "infrastructure": "基础设施",
    "nobel": "诺奖",
    "biology": "生命科学",
    "neural-networks": "神经网络",
    "science": "科学",
    "realtime": "实时交互",
    "existential-risk": "生存风险",
    "statement": "声明",
    "open-letter": "公开信",
    "governance": "治理",
    "copyright": "版权",
    "alignment": "对齐",
    "chatbot": "聊天机器人",
    "milestone": "里程碑",
    "diffusion": "扩散模型",
    "ethics": "伦理",
    "developer-tools": "开发者工具",
    "few-shot": "少样本",
    "bitter-lesson": "苦涩教训",
    "opinion": "观点",
    "nlp": "自然语言处理",
    "pretraining": "预训练",
    "attention": "注意力机制",
    "deep-learning": "深度学习",
    "go": "围棋",
    "reinforcement-learning": "强化学习",
    "computer-vision": "计算机视觉",
    "seq2seq": "序列到序列",
    "machine-translation": "机器翻译",
    "generative-models": "生成模型",
    "embeddings": "词向量",
    "qa": "问答",
    "dataset": "数据集",
    "dbn": "深度置信网络",
    "ai-winter": "AI 寒冬",
    "ai-foundations": "学科奠基",
    "turing-test": "图灵测试",
    "philosophy": "哲学",
    "games": "棋类",
    "backpropagation": "反向传播",
    "perceptron": "感知机",
    "dartmouth": "达特茅斯会议",
    "deep-blue": "深蓝",
    "google-cloud": "Google Cloud",
    "ai-safety": "安全",
}

KEEP_AS_IS = frozenset(
    {
        "o1", "o3", "bert", "sora", "clip", "alphago", "alphafold", "imagenet",
        "mnist", "lstm", "rnn", "cnn", "gan", "watson", "eliza", "chinchilla",
        "alexnet", "resnet", "word2vec", "moe", "rlhf", "instructgpt", "api",
        "agi", "us", "eu", "unesco", "codex", "copilot", "hinton",
        "claude-code", "stargate",
    }
)

DROP_TAGS = frozenset(
    {
        "openrouter", "hf-trending", "hf-textgen", "hf-blog", "hn-llm", "hn-ai",
        "techcrunch", "verge", "mittr", "qbitai", "leiphone", "tmtpost", "infoq",
        "media", "official", "community", "openrouter-model",
        "媒体报道", "官方公告", "社区讨论", "来源摘录",
    }
)

CATEGORY_KEYWORD = {
    "milestone": "里程碑",
    "model": "大模型",
    "research": "研究",
    "opinion": "观点",
    "policy": "产业",
}

_LOWER_SLUG_RE = re.compile(r"^[a-z][a-z0-9.-]*$")


def tag_label(tag: object) -> str:
    if not isinstance(tag, str):
        return ""
    value = tag.strip()
    if not value:
        return ""
    lower = value.lower()
    if lower in DROP_TAGS:
        return ""
    if lower in TAG_ALIASES:
        return TAG_ALIASES[lower]
    if _LOWER_SLUG_RE.match(value) and lower not in KEEP_AS_IS:
        return ""
    return value


def keywords_from_text(text: object, limit: int = 8) -> list[str]:
    value = str(text or "")
    if not value.strip():
        return []
    out: list[str] = []
    for label, pattern in RULES:
        if len(out) >= limit:
            break
        if pattern.search(value):
            out.append(label)
    return out


def keywords_for(entry: dict | None = None, limit: int = 10) -> list[str]:
    entry = entry or {}
    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
    out: list[str] = []

    def push(value: object) -> None:
        label = tag_label(value)
        if label and label not in out:
            out.append(label)

    for tag in tags:
        push(tag)

    text = " \n ".join(
        str(part)
        for part in (
            entry.get("title"),
            entry.get("titleEn"),
            entry.get("summary"),
            entry.get("organization"),
            entry.get("modelName"),
        )
        if part
    )
    for label in keywords_from_text(text, limit):
        push(label)

    if len(out) < 2:
        fallback = CATEGORY_KEYWORD.get(entry.get("category") or "")
        if fallback:
            push(fallback)
    if len(out) < 2:
        push("人工智能")
    return out[:limit]


KEYWORD_LABELS = [label for label, _ in RULES]
