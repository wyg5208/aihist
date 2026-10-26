"""Referrer classification: which door a visit came through.

Two callers need the same answer — the beacon (`api/track.py`) and the subscribe
form (`api/growth.py`) — so the vocabulary lives here rather than in either
router. One dictionary means "ai" on the traffic page and "ai" on a subscriber
row describe the same referrer.

`other` is a distinct bucket from `direct` on purpose. A link from a site we do
not recognise is not the same as a reader who typed the address, and folding the
two together would overstate direct arrivals.
"""

from __future__ import annotations

from urllib.parse import urlsplit

AI_REFERRERS = frozenset(
    {
        "chatgpt.com",
        "chat.openai.com",
        "chatgpt.livekit.cloud",
        "perplexity.ai",
        "claude.ai",
        "copilot.microsoft.com",
        "gemini.google.com",
        "bard.google.com",
        "you.com",
        "kimi.moonshot.cn",
        "kimi.com",
        "doubao.com",
        "tongyi.aliyun.com",
        "yuanbao.tencent.com",
        "metaso.cn",
    }
)

SEARCH_REFERRERS = frozenset(
    {
        "google.com",
        "google.com.hk",
        "google.co.jp",
        "bing.com",
        "cn.bing.com",
        "baidu.com",
        "duckduckgo.com",
        "so.com",
        "sogou.com",
        "yandex.com",
        "yandex.ru",
        "ecosia.org",
        "search.brave.com",
        "startpage.com",
        "search.naver.com",
        "search.yahoo.com",
    }
)

SOCIAL_REFERRERS = frozenset(
    {
        "x.com",
        "twitter.com",
        "t.co",
        "weibo.com",
        "zhihu.com",
        "v2ex.com",
        "reddit.com",
        "news.ycombinator.com",
        "linkedin.com",
        "facebook.com",
        "instagram.com",
        "threads.net",
        "mastodon.social",
        "t.me",
        "telegram.me",
        "bilibili.com",
        "douyin.com",
        # A visit from a WeChat article always carries the article origin, so
        # this one host stands for the whole public-account channel.
        "mp.weixin.qq.com",
        "xiaohongshu.com",
        "juejin.cn",
        "segmentfault.com",
        "sspai.com",
        "okjike.com",
        "producthunt.com",
        "github.com",
    }
)

CHANNELS = ("direct", "internal", "ai", "search", "social", "other")


def host_of(value: str) -> str:
    """Lower-cased host without `www.`, truncated to the column width."""
    text = (value or "").strip()
    if not text:
        return ""
    if "://" not in text:
        text = f"https://{text}"
    try:
        host = urlsplit(text).hostname or ""
    except ValueError:
        return ""
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    return host[:120]


def classify_channel(referrer: str, site_host: str) -> str:
    host = host_of(referrer)
    if not host:
        return "direct"
    if site_host and (host == site_host or host.endswith(f".{site_host}")):
        return "internal"
    if host in ("localhost", "127.0.0.1", "0.0.0.0"):
        return "internal"
    if host in AI_REFERRERS:
        return "ai"
    if host in SEARCH_REFERRERS:
        return "search"
    if host in SOCIAL_REFERRERS:
        return "social"
    return "other"


__all__ = [
    "AI_REFERRERS",
    "CHANNELS",
    "SEARCH_REFERRERS",
    "SOCIAL_REFERRERS",
    "classify_channel",
    "host_of",
]
