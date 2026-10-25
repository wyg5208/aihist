"""Vendor and model-series taxonomy, ported from functions/lib/taxonomy.mjs.

Order matters: the first rule whose match starts earliest wins, so a headline's
subject beats a company mentioned later in the sentence.
"""

from __future__ import annotations

import re
from typing import Any

from app.ingest.regexes import compile_ascii

VENDOR_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("OpenAI", compile_ascii(r"openai|open ai|chatgpt|dall[·-]?e|\bsora\b|\bcodex\b|\bgpt[-\s]?\d|\bo[1-9]\b", re.I)),
    ("Anthropic", compile_ascii(r"anthropic|claude", re.I)),
    ("Google", compile_ascii(r"google|deepmind|gemini|alphafold|imagen|\bveo\b|gemma|\bbard\b", re.I)),
    ("Meta", compile_ascii(r"\bmeta\b|llama", re.I)),
    ("xAI", compile_ascii(r"\bxai\b|\bx\.ai\b|\bgrok\b", re.I)),
    ("GitHub", compile_ascii(r"github", re.I)),
    ("Microsoft", compile_ascii(r"microsoft|微软|azure|\bphi-\d", re.I)),
    ("Stability AI", compile_ascii(r"stability ai", re.I)),
    ("NVIDIA", compile_ascii(r"nvidia|英伟达|nemotron|cuda", re.I)),
    ("Mistral", compile_ascii(r"mistral|mixtral", re.I)),
    ("Amazon", compile_ascii(r"amazon|亚马逊|\baws\b|\btitan\b", re.I)),
    ("Apple", compile_ascii(r"\bapple\b|苹果公司", re.I)),
    ("IBM", compile_ascii(r"\bibm\b|watson", re.I)),
    ("阿里云", compile_ascii(r"阿里|阿里巴巴|alibaba|qwen|通义|千问|魔搭|modelscope", re.I)),
    ("智谱", compile_ascii(r"智谱|zhipu|z\.ai|\bglm\b|chatglm|cogview|cogvideo", re.I)),
    ("DeepSeek", compile_ascii(r"deepseek|深度求索", re.I)),
    ("月之暗面", compile_ascii(r"月之暗面|moonshot|\bkimi\b", re.I)),
    ("MiniMax", compile_ascii(r"minimax|海螺|hailuo", re.I)),
    ("字节跳动", compile_ascii(r"字节|bytedance|doubao|豆包|seedream|seedance|即梦|火山引擎", re.I)),
    ("腾讯", compile_ascii(r"腾讯|tencent|混元|hunyuan", re.I)),
    ("百度", compile_ascii(r"百度|baidu|文心|ernie", re.I)),
    ("华为", compile_ascii(r"华为|huawei|昇腾|ascend|盘古|pangu|鸿蒙|harmonyos", re.I)),
    ("商汤", compile_ascii(r"商汤|sensetime|日日新|sensenova", re.I)),
    ("科大讯飞", compile_ascii(r"讯飞|iflytek|星火", re.I)),
    ("阶跃星辰", compile_ascii(r"阶跃|stepfun", re.I)),
    ("零一万物", compile_ascii(r"零一万物|01\.ai|yi-large|yi-lightning", re.I)),
    ("上海 AI 实验室", compile_ascii(r"上海人工智能实验室|shanghai ai lab|internlm|internvl|书生", re.I)),
    ("智源", compile_ascii(r"智源|baai|flagos", re.I)),
    ("智元", compile_ascii(r"智元|agibot", re.I)),
    ("宇树", compile_ascii(r"宇树|unitree", re.I)),
    ("Figure", compile_ascii(r"figure ai", re.I)),
    ("Tesla", compile_ascii(r"tesla|特斯拉|optimus", re.I)),
]

SERIES_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("GPT", compile_ascii(r"gpt[-\s]?\d|\bgpt\b|chatgpt|instructgpt", re.I)),
    ("Claude", compile_ascii(r"claude", re.I)),
    ("Gemini", compile_ascii(r"gemini", re.I)),
    ("Llama", compile_ascii(r"llama", re.I)),
    ("Qwen", compile_ascii(r"qwen|通义|千问", re.I)),
    ("GLM", compile_ascii(r"\bglm\b|chatglm", re.I)),
    ("DeepSeek", compile_ascii(r"deepseek", re.I)),
    ("Kimi", compile_ascii(r"\bkimi\b", re.I)),
    ("MiniMax", compile_ascii(r"minimax|\babab\b", re.I)),
    ("Grok", compile_ascii(r"\bgrok\b", re.I)),
    ("Mistral", compile_ascii(r"mistral|mixtral|codestral|pixtral", re.I)),
    ("Hunyuan", compile_ascii(r"hunyuan|混元", re.I)),
    ("ERNIE", compile_ascii(r"ernie|文心", re.I)),
    ("Doubao", compile_ascii(r"doubao|豆包", re.I)),
    ("Seed", compile_ascii(r"seedream|seedance|doubao[-\s]?seed|字节.*\bseed\b", re.I)),
    ("Step", compile_ascii(r"stepfun|阶跃|step-\d", re.I)),
    ("Yi", compile_ascii(r"yi-large|yi-lightning|yi-34b|01\.ai|零一万物", re.I)),
    ("Baichuan", compile_ascii(r"baichuan|百川", re.I)),
    ("InternLM", compile_ascii(r"internlm|internvl|书生|浦语", re.I)),
    ("Gemma", compile_ascii(r"gemma", re.I)),
    ("Phi", compile_ascii(r"\bphi-\d", re.I)),
    ("Nemotron", compile_ascii(r"nemotron", re.I)),
    ("Sora", compile_ascii(r"\bsora\b", re.I)),
    ("Veo", compile_ascii(r"\bveo\b", re.I)),
    ("Imagen", compile_ascii(r"imagen", re.I)),
    ("DALL·E", compile_ascii(r"dall[·-]?e", re.I)),
    ("CLIP", compile_ascii(r"\bclip\b", re.I)),
    ("Stable Diffusion", compile_ascii(r"stable[-\s]diffusion", re.I)),
    ("Copilot", compile_ascii(r"copilot", re.I)),
    ("o 系列", compile_ascii(r"\bo[1-9](?:[-\s](?:mini|pro|preview))?\b", re.I)),
    ("Muse", compile_ascii(r"\bmuse\b", re.I)),
]


def _match_rule(text: str, rules: list[tuple[str, re.Pattern[str]]]) -> str | None:
    best: tuple[str, int] | None = None
    for label, pattern in rules:
        found = pattern.search(text)
        if not found:
            continue
        if best is None or found.start() < best[1]:
            best = (label, found.start())
    return best[0] if best else None


def vendor_for(entry: dict[str, Any] | None = None) -> str | None:
    entry = entry or {}
    for field in ("organization", "modelName", "titleEn", "title"):
        value = entry.get(field)
        if not isinstance(value, str) or not value.strip():
            continue
        label = _match_rule(value, VENDOR_RULES)
        if label:
            return label
    tags = entry.get("tags")
    joined = " ".join(str(tag) for tag in tags) if isinstance(tags, list) else ""
    if joined:
        from_tags = _match_rule(joined, VENDOR_RULES)
        if from_tags:
            return from_tags
    if entry.get("category") == "model" and isinstance(entry.get("organization"), str):
        organization = entry["organization"].strip()
        if organization:
            return organization
    return None


def series_for(entry: dict[str, Any] | None = None) -> str | None:
    entry = entry or {}
    for field in ("modelName", "titleEn", "title", "organization"):
        value = entry.get(field)
        if not isinstance(value, str) or not value.strip():
            continue
        label = _match_rule(value, SERIES_RULES)
        if label:
            return label
    tags = entry.get("tags")
    joined = " ".join(str(tag) for tag in tags) if isinstance(tags, list) else ""
    if joined:
        from_tags = _match_rule(joined, SERIES_RULES)
        if from_tags:
            return from_tags
    if entry.get("category") == "model" and isinstance(entry.get("modelName"), str):
        model_name = entry["modelName"].strip()
        if model_name:
            return model_name
    return None
