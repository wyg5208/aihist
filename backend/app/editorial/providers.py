"""Vendor presets for the editorial panel.

Every entry speaks the OpenAI chat-completions dialect, so the panel posts to
`{base}/chat/completions` with `Authorization: Bearer {key}` and reads
`choices[0].message.content`. What differs between vendors - the endpoint, the
switch that turns chain-of-thought off, whether `temperature` may be sent at all
- lives here so `panel.py` stays vendor-agnostic.

Thinking mode matters more than it looks. All five enable it by default, and
reasoning tokens are billed against `max_tokens`. For a terse JSON ballot that is
pure waste: the budget runs out during reasoning and `content` comes back empty,
which the panel reads as an unparseable ballot. Each preset therefore switches it
off with that vendor's own spelling of the flag.
"""

from __future__ import annotations

from typing import Any

PROVIDERS: dict[str, dict[str, Any]] = {
    "deepseek": {
        "label": "DeepSeek",
        "base": "https://api.deepseek.com",
        "model": "deepseek-v4-flash",
        # `deepseek-chat` and `deepseek-reasoner` were retired on 2026-07-24.
        "extra": {"thinking": {"type": "disabled"}},
        "temperature": 0.0,
    },
    "qwen": {
        "label": "通义千问",
        # Beijing region; the Singapore one is dashscope-intl.aliyuncs.com.
        "base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen3.5-plus",
        # DashScope names the switch `enable_thinking`, a sibling of `model`.
        "extra": {"enable_thinking": False},
        "temperature": 0.0,
    },
    "glm": {
        "label": "智谱 GLM",
        "base": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4.7",
        # glm-5.3 and its flash variants answer 1210 "always thinks" when asked
        # to stop, so the slot stays on 4.7; temperature 0 keeps it deterministic.
        "extra": {"thinking": {"type": "disabled"}},
        "temperature": 0.0,
    },
    "kimi": {
        "label": "Kimi",
        "base": "https://api.moonshot.cn/v1",
        "model": "kimi-k3",
        "extra": {"thinking": {"type": "disabled"}},
        # kimi-k3 rejects every temperature but 1 ("only 1 is allowed for this
        # model"), so the field is omitted and the vendor default applies.
        "temperature": None,
    },
    "minimax": {
        "label": "MiniMax",
        "base": "https://api.minimax.cn/v1",
        "model": "MiniMax-M3",
        # M3 honours `thinking: disabled` (0.9s, 54 tokens) whereas the default
        # mode leaves <think> reasoning inline in `content`. M3.1-Flash and the
        # M2.x line are unusable here: the former answers 2013 "requires
        # adaptive thinking", the latter 2069 "no longer available".
        "extra": {"thinking": {"type": "disabled"}},
        "temperature": 0.0,
    },
}


def provider_names() -> tuple[str, ...]:
    return tuple(PROVIDERS)


def resolve_provider(name: object) -> dict[str, Any]:
    """Look up a preset. An unknown or empty name yields an empty preset, which
    leaves the slot on its explicit BASE/MODEL/KEY values."""
    return PROVIDERS.get(str(name or "").strip().lower(), {})


__all__ = ["PROVIDERS", "provider_names", "resolve_provider"]
