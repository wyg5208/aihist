"""User-agent classification, as two pure functions.

Both are total: an unrecognised client is still a valid answer (`other` /
`desktop`), never an exception. That matters because this runs on the hot path
of a public endpoint and on every line of an access log — a raise here would
either 500 a beacon or drop a log line.

The AI list is the part with commercial meaning: `crawl_hits.is_ai` is the only
evidence that an answer engine actually fetched a page, and it is what the
Traffic page reports as "被 AI 引用" instead of a proxy metric.
"""

from __future__ import annotations

# (token, bot_name, is_ai). Longer, more specific tokens come first:
# `applebot-extended` must win over `applebot`, and `gptbot` over `bot`.
_CRAWLERS: tuple[tuple[str, str, bool], ...] = (
    # Answer engines and model vendors — these are the citations that matter.
    ("gptbot", "GPTBot", True),
    ("oai-searchbot", "OAI-SearchBot", True),
    ("chatgpt-user", "ChatGPT-User", True),
    ("claudebot", "ClaudeBot", True),
    ("claude-web", "Claude-Web", True),
    ("anthropic-ai", "anthropic-ai", True),
    ("perplexitybot", "PerplexityBot", True),
    ("perplexity-user", "Perplexity-User", True),
    ("google-extended", "Google-Extended", True),
    ("ccbot", "CCBot", True),
    ("bytespider", "Bytespider", True),
    ("amazonbot", "Amazonbot", True),
    ("applebot-extended", "Applebot-Extended", True),
    ("meta-externalagent", "meta-externalagent", True),
    ("cohere-ai", "cohere-ai", True),
    ("mistralai-user", "MistralAI-User", True),
    ("youbot", "YouBot", True),
    ("diffbot", "Diffbot", True),
    ("imagesiftbot", "ImagesiftBot", True),
    ("timpibot", "Timpibot", True),
    # Search engines and generic crawlers: still bots, but not answer engines.
    ("googlebot", "Googlebot", False),
    ("bingbot", "Bingbot", False),
    ("baiduspider", "Baiduspider", False),
    ("yandexbot", "YandexBot", False),
    ("duckduckbot", "DuckDuckBot", False),
    ("applebot", "Applebot", False),
    ("petalbot", "PetalBot", False),
    ("semrushbot", "SemrushBot", False),
    ("ahrefsbot", "AhrefsBot", False),
    ("mj12bot", "MJ12bot", False),
    ("dotbot", "DotBot", False),
    ("sogou", "Sogou", False),
    ("360spider", "360Spider", False),
    ("facebookexternalhit", "facebookexternalhit", False),
    ("twitterbot", "Twitterbot", False),
    ("slackbot", "Slackbot", False),
    ("telegrambot", "TelegramBot", False),
)

_BROWSERS: tuple[tuple[str, str], ...] = (
    # In-app browsers first: WeChat and QQ both embed Chrome.
    ("micromessenger", "wechat"),
    ("qqbrowser", "qq"),
    ("ucbrowser", "uc"),
    ("baiduboxapp", "baidu"),
    ("samsungbrowser", "samsung"),
    ("edg/", "edge"),
    ("edga/", "edge"),
    ("opr/", "opera"),
    ("firefox/", "firefox"),
    ("fxios", "firefox"),
    ("crios", "chrome"),
    ("chrome/", "chrome"),
    ("safari/", "safari"),
)

_GENERIC_BOT_WORDS = ("bot", "spider", "crawler", "headlesschrome", "python-requests")


def detect_crawler(ua: str) -> tuple[str, bool]:
    """`(bot_name, is_ai)`. Empty name and `False` for anything a person holds."""
    text = (ua or "").lower()
    if not text:
        return "", False
    for token, name, is_ai in _CRAWLERS:
        if token in text:
            return name, is_ai
    if any(word in text for word in _GENERIC_BOT_WORDS):
        return "other-bot", False
    return "", False


def _device(text: str) -> str:
    if "ipad" in text or "tablet" in text:
        return "tablet"
    # An Android UA without "Mobile" is a tablet; with it, a phone.
    if "android" in text:
        return "mobile" if "mobile" in text else "tablet"
    if any(token in text for token in ("iphone", "ipod", "mobile", "windows phone")):
        return "mobile"
    return "desktop"


def classify_ua(ua: str) -> tuple[str, str]:
    """`(family, device)` for a beacon row. Bots get `("bot", "bot")`."""
    text = (ua or "").lower()
    if detect_crawler(ua)[0]:
        return "bot", "bot"
    for token, family in _BROWSERS:
        if token in text:
            return family, _device(text)
    return "other", _device(text)


__all__ = ["classify_ua", "detect_crawler"]
