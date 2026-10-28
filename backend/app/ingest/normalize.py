"""Candidate construction, ported from functions/lib/normalize.mjs.

Candidates are plain dictionaries on purpose: the reference implementation
relies on object spread and ad-hoc fields (`existingId`, `editorialStatus`…),
and mirroring that keeps the two implementations comparable line by line.
"""

from __future__ import annotations

import math
import re
from typing import Any

from app.domain.keywords import keywords_for, keywords_from_text
from app.domain.text import clean_text, html_to_text, iso_day, parse_iso
from app.ingest.regexes import compile_ascii

Candidate = dict[str, Any]

CATEGORY_KEYS = ["milestone", "model", "research", "opinion", "policy"]

HEAD_LABS = frozenset(
    {
        "openai", "anthropic", "google", "meta", "deepseek", "mistralai", "qwen",
        "x-ai", "z-ai", "moonshotai", "microsoft", "nvidia", "amazon", "cohere",
        "ai21", "baidu", "tencent", "alibaba", "minimax", "stepfun", "inclusionai",
        "upstage", "xiaomi", "sakana", "liquid", "bytedance", "perplexity",
    }
)

VENDOR_LABELS = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
    "meta": "Meta",
    "meta-llama": "Meta",
    "deepseek": "DeepSeek",
    "deepseek-ai": "DeepSeek",
    "mistralai": "Mistral AI",
    "mistralai-ai": "Mistral AI",
    "qwen": "阿里云 Qwen",
    "qwenlm": "阿里云 Qwen",
    "x-ai": "xAI",
    "z-ai": "Z.ai",
    "moonshotai": "月之暗面",
    "microsoft": "Microsoft",
    "nvidia": "NVIDIA",
    "amazon": "Amazon",
    "cohere": "Cohere",
    "ai21": "AI21 Labs",
    "baidu": "百度",
    "tencent": "腾讯",
    "alibaba": "阿里巴巴",
    "minimax": "MiniMax",
    "stepfun": "阶跃星辰",
    "inclusionai": "无问芯穹",
    "upstage": "Upstage",
    "xiaomi": "小米",
    "sakana": "Sakana AI",
    "liquid": "Liquid AI",
    "bytedance": "字节跳动",
    "perplexity": "Perplexity",
    "stabilityai": "Stability AI",
    "openbmb": "面壁智能",
    "01-ai": "零一万物",
}

MODALITY_LABELS = {
    "text": "文本",
    "image": "图像",
    "audio": "音频",
    "video": "视频",
    "file": "文件",
}

STOPWORDS = frozenset(
    (
        "a an the and or but of for to in on at by with from as is are was were be been being "
        "this that these those it its into over under after before about against between during "
        "new now how why what when where who whom which will would can could may might should "
        "we you they he she i our your their his her not no more most less than then so just "
        "via using use used make makes made get gets got one two three first last next "
        "show ask asks says said report reports update updates"
    ).split(" ")
)

TOPIC_WORDS = compile_ascii(
    r"\b(llm|llms|language model|language models|transformer|reasoning|agent|agents|agentic|"
    r"multimodal|alignment|rlhf|rlvr|diffusion|retrieval|rag|benchmark|scaling|fine[- ]tuning|"
    r"instruction|vision[- ]language|speech|code|robotics|safety|interpretability|"
    r"mixture[- ]of[- ]experts|moe|long[- ]context|world model|chain[- ]of[- ]thought|inference|"
    r"post[- ]training|pretraining|pre[- ]training|foundation model|generative)\b",
    re.I,
)

MODEL_WORD = compile_ascii(
    r"\b(gpt|chatgpt|claude|gemini|llama|qwen|deepseek|mistral|grok|kimi|glm|minimax|command|"
    r"phi|nemotron|olmo|yi|wan|hunyuan|ernie|doubao|seed|mimo|solar|jamba|reka|falcon|"
    r"stable diffusion|sora|veo|imagen|nano banana|gemma|granite|palm|bard|copilot)\b|"
    r"通义|文心|豆包|混元|星火|可灵|日日新|盘古|悟道|书生|百川|面壁|天工|元宝|夸克|阶跃|智元|宇树",
    re.I,
)

RELEASE_WORD = compile_ascii(
    r"\b(introduc\w*|launch\w*|unveil\w*|releas\w*|announc\w*|debut\w*|open[- ]sourc\w*|"
    r"ship\w*|roll(?:ing)? out|now available|available today|general availability|preview)\b|"
    r"发布|推出|上线|开源|开放|亮相|登场|问世|升级|迭代",
    re.I,
)

RESEARCH_WORD = compile_ascii(
    r"\b(research|paper|study|benchmark\w*|arxiv|scientist\w*|science|discover\w*|breakthrough|"
    r"evaluation|evaluat\w*|interpretab\w*|dataset|experiment\w*|proof|theorem|neurips|icml|iclr)\b|"
    r"论文|研究|基准|测评|数据集|突破|登顶|刷新|实验|算法|nature|science",
    re.I,
)

POLICY_WORD = compile_ascii(
    r"\b(polic\w*|regulat\w*|law|laws|act|court|government|senate|congress|parliament|eu|"
    r"european union|ban\w*|governance|security|copyright|lawsuit|investigat\w*|sanction\w*|"
    r"privacy|executive order|white house|ministry|agency|compliance|antitrust|safety institute)\b|"
    r"政策|监管|法案|法规|条例|备案|合规|治理|标准|白皮书|规划|指导意见|管理办法|安全评估|伦理|新规",
    re.I,
)

OPINION_WORD = compile_ascii(
    r"\b(opinion|interview|essay|perspective|podcast|conversation|q&a|letter|manifesto|"
    r"the case for|we think|i think|reflection\w*|lessons|thoughts|why |what |how )\b|"
    r"访谈|对话|专访|观点|演讲|撰文|专栏|评论|复盘|思考|展望|判断",
    re.I,
)

AI_RELEVANCE = compile_ascii(
    r"(?:^|[^A-Za-z])(?:ai|llms?|agi|aigc|gpt|chatgpt|claude|gemini|llama|qwen|deepseek|kimi|"
    r"glm|minimax|openai|anthropic|transformer|agents?|agentic)(?:[^A-Za-z]|$)|"
    r"人工智能|大模型|生成式|智能体|机器学习|深度学习|神经网络|算法|算力|芯片|半导体|机器人|具身|"
    r"脑机|自动驾驶|智能驾驶|智驾|多模态|语音|图像生成|视频生成|文生图|文生视频|开源模型|推理模型|"
    r"通用人工智能|超级智能|智能眼镜|智元|宇树",
    re.I,
)

_SLUG_CLEAN_RE = compile_ascii(r"[^a-z0-9.]+")
_SLUG_TRIM_RE = compile_ascii(r"^-+|-+$")
_ENTITY_STRIP_RE = compile_ascii(r"&[a-z]+;")
_TOKEN_SPLIT_RE = compile_ascii(r"[^a-z0-9.]+")
_TOKEN_DOT_RE = compile_ascii(r"^\.+|\.+$")
_CJK_RUN_RE = compile_ascii(r"[\u3400-\u9fff]+")
_DIGIT_RE = compile_ascii(r"\d")

_TIER_SUFFIX = compile_ascii(
    r"[-_.](pro|max|plus|premium|flash|flashx|mini|super|ultra|lite|air|nano|turbo|sol|luna|"
    r"astra|terra|omni|prime|thinking|preview|instruct|chat|it|base|batch|free|distill|"
    r"reasoner|vl|vision|audio|realtime|codex)$"
)

_MODEL_TAIL_1 = compile_ascii(r":(free|batch|thinking|online)$")
_MODEL_TAIL_2 = compile_ascii(
    r"[-_](gguf|awq|gptq|4bit|8bit|fp8|fp16|bf16|mlx|onnx|exl2|ggml|int4|int8)$"
)
_MODEL_TAIL_3 = compile_ascii(r"[-_](instruct|chat|it|base|preview|thinking|reasoning)$")
_MODEL_TAIL_4 = compile_ascii(r"([-_]\d{4})([-_]\d{2}){1,2}$")
_MODEL_TAIL_5 = compile_ascii(r"[-_]\d{4}$")

_VENDOR_ALIASES = {
    "deepseek-ai": "deepseek",
    "meta-llama": "meta",
    "qwenlm": "qwen",
    "mistralai-ai": "mistralai",
    "stabilityai": "stability",
    "01-ai": "01ai",
}
_VENDOR_STRIP_RE = compile_ascii(r"-(ai|hq|inc|labs|research|official)$")

CJK_STOP_BIGRAMS = frozenset(
    {
        "一个", "我们", "他们", "可以", "已经", "正在", "以及", "对于", "通过",
        "进行", "表示", "目前", "如何", "什么", "这个", "那个", "没有", "还是",
    }
)


def slug_key(value: object) -> str:
    text = str(value or "").lower()
    text = _SLUG_CLEAN_RE.sub("-", text)
    return _SLUG_TRIM_RE.sub("", text)


def model_key_of(value: object) -> str:
    key = str(value or "").lower()
    if "/" in key:
        key = key.split("/")[-1]
    key = _MODEL_TAIL_1.sub("", key)
    key = _MODEL_TAIL_2.sub("", key)
    key = _MODEL_TAIL_3.sub("", key)
    key = _MODEL_TAIL_4.sub("", key)
    key = _MODEL_TAIL_5.sub("", key)
    return slug_key(key)


def model_aliases_of(value: object) -> list[str]:
    aliases: list[str] = []

    def add(raw: object) -> None:
        key = model_key_of(raw)
        if key and key not in aliases:
            aliases.append(key)

    add(value)
    text = str(value or "").lower()
    if "/" in text:
        add(text.split("/")[-1])
    return aliases


def model_family_key(value: object) -> str:
    key = model_key_of(value)
    previous = ""
    while key != previous:
        previous = key
        key = _TIER_SUFFIX.sub("", key)
        key = compile_ascii(r"[-_.]+$").sub("", key)
    return key


def vendor_key_of(value: object) -> str:
    key = compile_ascii(r"\s+").sub("-", str(value or "").lower())
    if key in _VENDOR_ALIASES:
        return _VENDOR_ALIASES[key]
    return _VENDOR_STRIP_RE.sub("", key)


def title_tokens(title: object) -> list[str]:
    raw = _ENTITY_STRIP_RE.sub(" ", str(title or "").lower())
    tokens: list[str] = []
    for token in _TOKEN_SPLIT_RE.sub(" ", raw).split(" "):
        cleaned = _TOKEN_DOT_RE.sub("", token)
        if len(cleaned) >= 3 or _DIGIT_RE.search(cleaned):
            if cleaned and cleaned not in STOPWORDS:
                tokens.append(cleaned)
    for run in _CJK_RUN_RE.findall(raw):
        for index in range(len(run) - 1):
            bigram = run[index : index + 2]
            if bigram not in CJK_STOP_BIGRAMS:
                tokens.append(bigram)
    # Stable de-duplication, capped like the reference implementation.
    seen: set[str] = set()
    out: list[str] = []
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        out.append(token)
    return out[:18]


def normalize_url(value: object) -> str:
    from urllib.parse import parse_qsl, urlencode, urlparse

    try:
        parsed = urlparse(str(value))
    except ValueError:
        return ""
    if not parsed.scheme or not parsed.netloc:
        return ""
    host = parsed.hostname or ""
    if host.startswith("www."):
        host = host[4:]
    host = host.lower()
    path = parsed.path
    while path.endswith("/"):
        path = path[:-1]
    if host in ("arxiv.org", "export.arxiv.org"):
        absolute = re.search(r"/abs/([^/]+)", path)
        if absolute:
            identifier = re.sub(r"v\d+$", "", absolute.group(1))
            path = f"/abs/{identifier}"
    kept = [
        (key, val)
        for key, val in parse_qsl(parsed.query, keep_blank_values=True)
        if not re.match(r"^utm_|^(ref|source|fbclid|gclid)$", key, re.I)
    ]
    query = f"?{urlencode(kept)}" if kept else ""
    return f"{host}{path}{query}"


def vendor_label(vendor: object) -> str:
    key = str(vendor or "").lower()
    if key in VENDOR_LABELS:
        return VENDOR_LABELS[key]
    spaced = re.sub(r"[-_]", " ", key)
    return re.sub(r"\b\w", lambda match: match.group(0).upper(), spaced)


def is_head_lab(vendor: object) -> bool:
    return vendor_key_of(vendor) in HEAD_LABS


def format_context(value: object) -> str:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(number) or number <= 0:
        return ""
    if number >= 1_000_000:
        millions = number / 1_000_000
        shown = int(millions) if float(millions).is_integer() else round(millions, 1)
        return f"{shown}M token"
    if number >= 1000:
        return f"{round(number / 1000)}K token"
    return f"{int(number)} token"


def modality_text(inputs: object) -> str:
    if not isinstance(inputs, list):
        inputs = []
    labels = [MODALITY_LABELS.get(item, item) for item in inputs if item]
    labels = [label for label in labels if label]
    if not labels:
        return ""
    unique: list[str] = []
    for label in labels:
        if label not in unique:
            unique.append(label)
    return f"{'、'.join(unique)}输入"


def within_days(value: object, days: int, now_ms: int) -> bool:
    parsed = parse_iso(str(value)) if value else None
    if parsed is None:
        return False
    delta_ms = now_ms - int(parsed.timestamp() * 1000)
    return delta_ms <= days * 86_400_000


def has_word(pattern: re.Pattern[str], text: str) -> bool:
    return bool(pattern.search(text))


def classify_title(title: object, summary: object, url: object) -> str:
    head = str(title or "")
    text = f"{head} {summary or ''}"
    if re.search(r"arxiv\.org/(abs|pdf)/", str(url or ""), re.I):
        return "research"
    if POLICY_WORD.search(head):
        return "policy"
    if RESEARCH_WORD.search(head) and not RELEASE_WORD.search(head):
        return "research"
    if (MODEL_WORD.search(head) or re.search(r"模型|智能体|助手", head)) and RELEASE_WORD.search(head):
        return "model"
    if OPINION_WORD.search(head):
        return "opinion"
    if RESEARCH_WORD.search(text):
        return "research"
    if MODEL_WORD.search(text) and RELEASE_WORD.search(text):
        return "model"
    if POLICY_WORD.search(text):
        return "policy"
    if OPINION_WORD.search(text):
        return "opinion"
    return "policy"


OFFICIAL_NOISE = [
    compile_ascii(r"\b(customer|customers|case study|testimonial|employees?|workers?|workplace)\b", re.I),
    compile_ascii(r"\b(cuts?|cut|saves?|boosts?|triples?|doubles?|halves?|frees? up|reduces?|accelerat\w*|helps?|ships?|brings?|powers?|turns?)\b", re.I),
    compile_ascii(r"\bwith (openai|chatgpt|gpt[-\s]?\d|claude|codex|gemini)\b", re.I),
    compile_ascii(r"\bhow [a-z0-9]", re.I),
    compile_ascii(r"\bwatch\b", re.I),
    compile_ascii(r"\b(partner\w*|collaborat\w*|accenture|infosys|cognizant|deloitte|pwc|kpmg|salesforce|tcs|bcg|menlo|nvidia|microsoft|amazon|google cloud|bedrock|vertex|foundry)\b", re.I),
    compile_ascii(r"\b(appoints?|appointed|joins?|hires?|hiring|board|managing director|general manager|head of|leadership)\b", re.I),
    compile_ascii(r"\b(raises?|funding|series [a-h]|valuation|invests?|investment|acquires?|acquisition|s-?1|ipo)\b", re.I),
    compile_ascii(r"\b(office|opens?|opening|expands?|expansion|presence|seoul|tokyo|paris|munich|milan|sydney|bengaluru|india|canada|brazil|europe|singapore|australia|iceland|rwanda|poland|uk)\b", re.I),
    compile_ascii(r"\b(polic\w*|terms|pricing|price|certification|compliance|deprecat\w*|limits?|api|sdk|enterprise|education|teachers?|students?|universit\w*|nonprofits?|small business|financial services|healthcare|life sciences|government|public sector|national security|defense|military|elections?|midterms|law|legal|grants?|fellowship|initiative|programmes?|programs?|fund)\b", re.I),
    compile_ascii(r"\b(access|availability|available|launch(?:es|ed|ing)? in|now in|coming to)\b", re.I),
]

_MAJOR_MODEL_TITLE_RE = compile_ascii(
    r"\b(gpt|claude|gemini|llama|qwen|deepseek|grok|kimi|glm|minimax)\b.*\d", re.I
)
_NOTABLE_RESEARCH_RE = compile_ascii(
    r"\b(research|paper|benchmark|dataset|evaluation|safety|alignment|interpretab\w*|reasoning|"
    r"agents?|multimodal|mathematic\w*|coding|science|model)\b",
    re.I,
)


def is_notable_official(category: object, title: object) -> bool:
    if not isinstance(title, str) or not title.strip():
        return False
    if any(pattern.search(title) for pattern in OFFICIAL_NOISE):
        return False
    if category == "model":
        return bool(RELEASE_WORD.search(title) or _MAJOR_MODEL_TITLE_RE.search(title))
    if category == "research":
        if MODEL_WORD.search(title):
            return True
        return bool(_NOTABLE_RESEARCH_RE.search(title))
    if category == "milestone":
        return True
    return False


def extract_tags(value: object) -> list[str]:
    return keywords_from_text(value, 8)


def _drop(
    drops: list[dict[str, Any]] | None,
    source: dict[str, Any],
    *,
    code: str,
    external_id: object = "",
    title: object = "",
    url: object = "",
    published_at: object = None,
) -> None:
    """Record *why* an item never became a candidate.

    Every `continue` below used to be a silent discard, which made the console
    unable to answer “why is this story missing”. The record is deliberately a
    plain dict in the same shape as a raw item, because the ledger writes it
    straight into `raw_items`.
    """
    if drops is None:
        return
    drops.append(
        {
            "sourceKey": str(source.get("key") or ""),
            "sourceFamily": str(source.get("family") or ""),
            "sourceName": str(source.get("name") or ""),
            "externalId": str(external_id or ""),
            "title": str(title or "")[:300],
            "url": str(url or ""),
            "publishedAt": published_at if isinstance(published_at, str) else None,
            "reasonCode": code,
        }
    )


def base_candidate(overrides: dict[str, Any]) -> Candidate:
    event_date = overrides.get("eventDate") or ""
    title = overrides.get("title") or ""
    title_en = overrides.get("titleEn") or None
    summary = overrides.get("summary")
    category = overrides.get("category")
    return {
        "key": overrides.get("key"),
        "category": category,
        "title": title,
        "titleEn": title_en,
        "summary": summary,
        "summaryKind": overrides.get("summaryKind") or "template",
        "eventDate": event_date,
        "datePrecision": overrides.get("datePrecision") or "day",
        "sortDate": event_date,
        "year": int(event_date[:4]) if event_date else 0,
        "organization": overrides.get("organization") or None,
        "modelName": overrides.get("modelName") or None,
        "tags": keywords_for(
            {
                "tags": overrides.get("tags"),
                "title": title,
                "titleEn": title_en,
                "summary": summary,
                "organization": overrides.get("organization"),
                "modelName": overrides.get("modelName"),
                "category": category,
            }
        ),
        "meta": overrides.get("meta") or {},
        "evidence": [overrides["evidence"]] if overrides.get("evidence") else [],
        "modelKey": overrides.get("modelKey") or None,
        "familyKey": overrides.get("familyKey") or None,
        "aliases": overrides.get("aliases") or [],
        "urls": overrides.get("urls") or [],
        "tokens": title_tokens(title_en or title),
        "signals": {
            "headLab": bool(overrides.get("headLab")),
            "hnPoints": int(overrides.get("hnPoints") or 0),
            "hfLikes": int(overrides.get("hfLikes") or 0),
            "officialPrimary": bool(overrides.get("officialPrimary")),
            "mediaOnly": bool(overrides.get("mediaOnly")),
            "sitemap": bool(overrides.get("sitemap")),
            "notableOfficial": bool(overrides.get("notableOfficial")),
            "domestic": bool(overrides.get("domestic")),
        },
    }


def openrouter_candidates(
    payload: dict,
    now_ms: int,
    *,
    drops: list[dict[str, Any]] | None = None,
    source: dict[str, Any] | None = None,
) -> list[Candidate]:
    source = source or {"key": "openrouter", "family": "openrouter", "name": "OpenRouter"}
    cutoff_ms = now_ms - 120 * 86_400_000
    seen: set[str] = set()
    out: list[Candidate] = []
    for model in payload.get("items") or []:
        created = model.get("created")
        parsed = parse_iso(str(created)) if created else None
        if parsed is None or int(parsed.timestamp() * 1000) < cutoff_ms:
            _drop(
                drops,
                source,
                code="date_missing" if parsed is None else "window_age",
                external_id=model.get("id"),
                title=model.get("name") or model.get("id"),
                url=f"https://openrouter.ai/{model.get('canonicalSlug') or model.get('id') or ''}",
                published_at=created if isinstance(created, str) else None,
            )
            continue
        model_id = model.get("id") or ""
        if re.search(r":free$|:batch$", model_id) or model_id.startswith("~"):
            _drop(
                drops,
                source,
                code="model_filter",
                external_id=model_id,
                title=model.get("name") or model_id,
            )
            continue
        canonical = model.get("canonicalSlug") or model_id
        if canonical in seen:
            _drop(
                drops,
                source,
                code="duplicate",
                external_id=model_id,
                title=model.get("name") or model_id,
            )
            continue
        seen.add(canonical)
        vendor_key = model_id.split("/")[0]
        name = model.get("name") or model_id
        display_name = name.split(":", 1)[1].strip() if ":" in name else name
        if ":" in name:
            display_name = ":".join(name.split(":")[1:]).strip()
        vendor = vendor_label(vendor_key)
        open_weights = bool(model.get("huggingFaceId"))
        date = iso_day(created)
        context = format_context(model.get("contextLength"))
        modality = modality_text(model.get("inputModalities")) or (model.get("modality") or "")
        parts = [f"{display_name} 由 {vendor} 提供，{'开放权重' if open_weights else '闭源 API'}模型。"]
        if context:
            parts.append(f"上下文窗口 {context}。")
        if modality:
            parts.append(f"支持{modality}，输出为文本。")
        parts.append("条目由 OpenRouter 模型目录自动汇总。")
        out.append(
            base_candidate(
                {
                    "key": f"openrouter:{model_id}",
                    "category": "model",
                    "title": f"{vendor} 发布 {display_name}",
                    "titleEn": name,
                    "summary": "".join(parts),
                    "summaryKind": "template",
                    "eventDate": date,
                    "organization": vendor,
                    "modelName": display_name,
                    "tags": ["开源" if open_weights else "闭源", vendor],
                    "meta": {
                        "vendor": vendor,
                        "vendorKey": vendor_key_of(vendor_key),
                        "openWeights": open_weights,
                        "contextWindow": model.get("contextLength"),
                        "modality": model.get("modality"),
                        "inputModalities": model.get("inputModalities"),
                        "openRouterId": model_id,
                        "canonicalSlug": canonical,
                        "huggingFaceId": model.get("huggingFaceId"),
                        "familyKey": model_family_key(model_id),
                    },
                    "modelKey": model_key_of(model_id),
                    "familyKey": model_family_key(model_id),
                    "aliases": model_aliases_of(model_id),
                    "urls": [normalize_url(f"https://openrouter.ai/{canonical}")],
                    "headLab": is_head_lab(vendor_key),
                    "evidence": {
                        "sourceKey": "openrouter",
                        "sourceFamily": "openrouter",
                        "sourceName": "OpenRouter",
                        "title": name,
                        "url": f"https://openrouter.ai/{canonical}",
                        "publishedAt": created,
                        "externalId": model_id,
                    },
                }
            )
        )
    return out


_QUANT_TAG_RE = compile_ascii(r"^(gguf|awq|gptq|4bit|8bit|fp8|fp16|mlx|onnx|exl2|ggml|int4|int8)$", re.I)
_FINETUNE_TAG_RE = compile_ascii(r"base_model:(finetune|adapter|merge)", re.I)
_HF_SUFFIX_RE = compile_ascii(r"[-_](gguf|awq|gptq|fp8)$", re.I)


def hf_candidates(
    payload: dict,
    now_ms: int,
    *,
    drops: list[dict[str, Any]] | None = None,
    source: dict[str, Any] | None = None,
) -> list[Candidate]:
    source = source or {"key": "hf-trending", "family": "huggingface", "name": "Hugging Face"}
    cutoff_ms = now_ms - 180 * 86_400_000
    seen: set[str] = set()
    out: list[Candidate] = []
    for model in payload.get("items") or []:
        model_id = model.get("id") or ""
        created_at = model.get("createdAt")
        parsed = parse_iso(str(created_at)) if created_at else None
        if parsed is None or int(parsed.timestamp() * 1000) < cutoff_ms:
            _drop(
                drops,
                source,
                code="date_missing" if parsed is None else "window_age",
                external_id=model_id,
                title=model_id,
                url=f"https://huggingface.co/{model_id}",
                published_at=created_at if isinstance(created_at, str) else None,
            )
            continue
        if model_id in seen:
            _drop(
                drops,
                source,
                code="duplicate",
                external_id=model_id,
                title=model_id,
                url=f"https://huggingface.co/{model_id}",
            )
            continue
        seen.add(model_id)
        tags = model.get("tags") or []
        if any(_QUANT_TAG_RE.match(tag) for tag in tags) or any(
            _FINETUNE_TAG_RE.search(tag) for tag in tags
        ):
            _drop(
                drops,
                source,
                code="model_filter",
                external_id=model_id,
                title=model_id,
                url=f"https://huggingface.co/{model_id}",
            )
            continue
        likes = int(model.get("likes") or 0)
        if likes < 20:
            _drop(
                drops,
                source,
                code="below_likes",
                external_id=model_id,
                title=model_id,
                url=f"https://huggingface.co/{model_id}",
            )
            continue
        repo_name = model_id.split("/")[-1] or model_id
        display_name = _HF_SUFFIX_RE.sub("", repo_name)
        vendor_key = str(model.get("author") or "").lower()
        vendor = vendor_label(vendor_key)
        date = iso_day(created_at)
        downloads = int(model.get("downloads") or 0)
        summary = (
            f"{display_name} 在 Hugging Face 开源发布，作者 {vendor}。"
            f"当前获得 {likes:,} 次点赞、{downloads:,} 次下载。"
            "条目由 Hugging Face 模型库自动汇总。"
        )
        out.append(
            base_candidate(
                {
                    "key": f"hf:{model_id}",
                    "category": "model",
                    "title": f"{vendor} 开源 {display_name}",
                    "titleEn": model_id,
                    "summary": summary,
                    "summaryKind": "template",
                    "eventDate": date,
                    "organization": vendor,
                    "modelName": display_name,
                    "tags": ["开源", vendor],
                    "meta": {
                        "vendor": vendor,
                        "vendorKey": vendor_key_of(vendor_key),
                        "openWeights": True,
                        "hfRepo": model_id,
                        "likes": likes,
                        "downloads": downloads,
                        "trendingScore": model.get("trendingScore"),
                        "pipelineTag": model.get("pipelineTag"),
                        "familyKey": model_family_key(model_id),
                    },
                    "modelKey": model_key_of(model_id),
                    "familyKey": model_family_key(model_id),
                    "aliases": model_aliases_of(model_id),
                    "urls": [normalize_url(f"https://huggingface.co/{model_id}")],
                    "headLab": is_head_lab(vendor_key),
                    "hfLikes": likes,
                    "evidence": {
                        "sourceKey": "hf-trending",
                        "sourceFamily": "huggingface",
                        "sourceName": "Hugging Face",
                        "title": model_id,
                        "url": f"https://huggingface.co/{model_id}",
                        "publishedAt": created_at,
                        "externalId": model_id,
                    },
                }
            )
        )
    return out


def arxiv_candidates(
    payload: dict,
    now_ms: int,
    *,
    drops: list[dict[str, Any]] | None = None,
    source: dict[str, Any] | None = None,
) -> list[Candidate]:
    source = source or {"key": "arxiv", "family": "arxiv", "name": "arXiv"}
    out: list[Candidate] = []
    for paper in payload.get("items") or []:
        if not paper.get("publishedAt") or not within_days(paper["publishedAt"], 10, now_ms):
            _drop(
                drops,
                source,
                code="date_missing" if not paper.get("publishedAt") else "window_age",
                external_id=paper.get("id"),
                title=paper.get("title"),
                url=paper.get("url"),
                published_at=paper.get("publishedAt"),
            )
            continue
        if not TOPIC_WORDS.search(paper.get("title") or ""):
            _drop(
                drops,
                source,
                code="topic_gate",
                external_id=paper.get("id"),
                title=paper.get("title"),
                url=paper.get("url"),
                published_at=paper.get("publishedAt"),
            )
            continue
        date = iso_day(paper["publishedAt"])
        excerpt = clean_text(paper.get("summary"), 240)
        title = paper.get("title") or ""
        out.append(
            base_candidate(
                {
                    "key": f"arxiv:{paper.get('id')}",
                    "category": "research",
                    "title": title,
                    "titleEn": title,
                    "summary": f"arXiv 论文：{title}。{excerpt}",
                    "summaryKind": "excerpt",
                    "eventDate": date,
                    "organization": "arXiv",
                    "tags": ["论文", "研究", *extract_tags(f"{title} {paper.get('summary') or ''}")],
                    "meta": {
                        "arxivId": paper.get("id"),
                        "categories": paper.get("categories"),
                        "excerpt": excerpt,
                    },
                    "urls": [normalize_url(paper.get("url"))],
                    "evidence": {
                        "sourceKey": "arxiv",
                        "sourceFamily": "arxiv",
                        "sourceName": "arXiv",
                        "title": title,
                        "url": paper.get("url"),
                        "publishedAt": paper.get("publishedAt"),
                        "externalId": paper.get("externalId"),
                    },
                }
            )
        )
    return out


def community_candidates(
    payload: dict,
    now_ms: int,
    *,
    drops: list[dict[str, Any]] | None = None,
    source: dict[str, Any] | None = None,
) -> list[Candidate]:
    source = source or {"key": "hn", "family": "community", "name": "Hacker News"}
    out: list[Candidate] = []
    for hit in payload.get("items") or []:
        if not hit.get("publishedAt") or not within_days(hit["publishedAt"], 14, now_ms):
            _drop(
                drops,
                source,
                code="date_missing" if not hit.get("publishedAt") else "window_age",
                external_id=hit.get("externalId") or hit.get("id"),
                title=hit.get("title"),
                url=hit.get("hnLink") or hit.get("url"),
                published_at=hit.get("publishedAt"),
            )
            continue
        title = html_to_text(hit.get("title"), 300)
        if len(title) < 12:
            _drop(
                drops,
                source,
                code="title_too_short",
                external_id=hit.get("externalId") or hit.get("id"),
                title=title,
                url=hit.get("hnLink") or hit.get("url"),
                published_at=hit.get("publishedAt"),
            )
            continue
        category = classify_title(title, "", hit.get("url"))
        date = iso_day(hit["publishedAt"])
        points = int(hit.get("points") or 0)
        comments = int(hit.get("comments") or 0)
        out.append(
            base_candidate(
                {
                    "key": f"hn:{hit.get('id')}",
                    "category": category,
                    "title": title,
                    "summary": f"Hacker News 社区讨论：{title}。发布时获得 {points} 分、{comments} 条评论。",
                    "summaryKind": "template",
                    "eventDate": date,
                    "organization": "Hacker News",
                    "tags": extract_tags(title),
                    "meta": {
                        "hnPoints": points,
                        "hnComments": comments,
                        "hnLink": hit.get("hnLink"),
                        "hnAuthor": hit.get("author"),
                    },
                    "urls": [normalize_url(hit.get("url"))],
                    "hnPoints": points,
                    "evidence": {
                        "sourceKey": "hn",
                        "sourceFamily": "community",
                        "sourceName": "Hacker News",
                        "title": title,
                        "url": hit.get("hnLink"),
                        "publishedAt": hit.get("publishedAt"),
                        "externalId": hit.get("externalId"),
                    },
                }
            )
        )
    return out


def feed_candidates(
    payload: dict,
    source: dict,
    now_ms: int,
    *,
    drops: list[dict[str, Any]] | None = None,
) -> list[Candidate]:
    out: list[Candidate] = []
    window_days = 45 if source.get("family") == "official" else 21
    for item in payload.get("items") or []:
        if not item.get("publishedAt") or not within_days(item["publishedAt"], window_days, now_ms):
            _drop(
                drops,
                source,
                code="date_missing" if not item.get("publishedAt") else "window_age",
                external_id=item.get("externalId"),
                title=item.get("title"),
                url=item.get("url"),
                published_at=item.get("publishedAt"),
            )
            continue
        title = clean_text(item.get("title"), 300)
        if len(title) < 12:
            _drop(
                drops,
                source,
                code="title_too_short",
                external_id=item.get("externalId"),
                title=title,
                url=item.get("url"),
                published_at=item.get("publishedAt"),
            )
            continue
        if source.get("aiOnly") and not AI_RELEVANCE.search(title):
            _drop(
                drops,
                source,
                code="ai_only_miss",
                external_id=item.get("externalId"),
                title=title,
                url=item.get("url"),
                published_at=item.get("publishedAt"),
            )
            continue
        category = classify_title(title, item.get("summary"), item.get("url"))
        date = iso_day(item["publishedAt"])
        sitemap = source.get("kind") == "sitemap"
        notable_official = (
            source.get("family") == "official"
            and not sitemap
            and is_notable_official(category, title)
        )
        summary = (
            f"来源摘录：{clean_text(item.get('summary'), 320)}"
            if item.get("summary")
            else f"{source.get('name')} 发布的条目：「{title}」。原文请见证据链接。"
        )
        out.append(
            base_candidate(
                {
                    "key": f"{source.get('key')}:{item.get('externalId')}",
                    "category": category,
                    "title": title,
                    "titleEn": title,
                    "summary": summary,
                    "summaryKind": "excerpt" if item.get("summary") else "template",
                    "eventDate": date,
                    "organization": source.get("name"),
                    "tags": [
                        *(["国内"] if source.get("domestic") else []),
                        *extract_tags(f"{title} {item.get('summary') or ''}"),
                    ],
                    "meta": {"feed": source.get("key"), "feedUrl": source.get("url")},
                    "urls": [normalize_url(item.get("url"))],
                    "headLab": source.get("family") == "official",
                    "officialPrimary": source.get("family") == "official",
                    "mediaOnly": source.get("family") == "media",
                    "domestic": bool(source.get("domestic")),
                    "sitemap": sitemap,
                    "notableOfficial": notable_official,
                    "evidence": {
                        "sourceKey": source.get("key"),
                        "sourceFamily": source.get("family"),
                        "sourceName": source.get("name"),
                        "title": title,
                        "url": item.get("url"),
                        "publishedAt": item.get("publishedAt"),
                        "externalId": item.get("externalId"),
                    },
                }
            )
        )
    return out


def normalize_results(results: list[dict], now_ms: int) -> dict[str, Any]:
    """Dispatch each fetched source to its parser builder.

    Dispatch is by `kind` — the column the source registry stores — with the
    historical key-prefix rules taking precedence, because those prefixes are
    reserved (`catalog.validate_key` refuses them) and the golden fixtures froze
    what they currently produce. Concretely: `hf-blog` is `kind="feed"` but its
    key matches `hf-`, so it keeps being routed to the Hugging Face model
    builder, which yields nothing for a feed. That is a known defect, and it is
    only safe to correct together with a golden re-export — not in a migration
    that is supposed to change no existing verdict.

    `drops` is new: every item a builder refuses is described once, so the
    ledger can answer “why is this not in the archive”. It is an extra key, not
    a change to `candidates`/`failed`, which is what the parity test compares.
    """
    candidates: list[Candidate] = []
    failed: list[dict] = []
    drops: list[dict[str, Any]] = []
    for result in results:
        if not result.get("ok"):
            failed.append(
                {
                    "key": result.get("key"),
                    "name": result.get("name"),
                    "error": result.get("error"),
                    "ms": result.get("ms"),
                }
            )
            continue
        key = result.get("key") or ""
        source = {
            "key": key,
            "family": result.get("family"),
            "name": result.get("name"),
            "kind": result.get("kind") or "",
            "url": result.get("url") or "",
            "domestic": bool(result.get("domestic")),
            "aiOnly": bool(result.get("aiOnly")),
        }
        kind = source["kind"]
        if key == "openrouter":
            kind = "openrouter"
        elif key.startswith("hf-"):
            kind = "hf"
        elif key == "arxiv":
            kind = "arxiv"
        elif key.startswith("hn-"):
            kind = "hn"
        elif not kind:
            kind = "feed"
        if kind == "openrouter":
            candidates.extend(
                openrouter_candidates(result, now_ms, drops=drops, source=source)
            )
        elif kind == "hf":
            candidates.extend(hf_candidates(result, now_ms, drops=drops, source=source))
        elif kind == "arxiv":
            candidates.extend(arxiv_candidates(result, now_ms, drops=drops, source=source))
        elif kind == "hn":
            candidates.extend(
                community_candidates(result, now_ms, drops=drops, source=source)
            )
        else:
            candidates.extend(feed_candidates(result, source, now_ms, drops=drops))
    return {"candidates": candidates, "failed": failed, "drops": drops}
