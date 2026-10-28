"""The source catalogue: what we are willing to fetch, and why.

`SOURCES` in `sources.py` is frozen as `SEED_SOURCES`. Two reasons: the parity
test parametrises over `range(17)` and compares each parsed result in order, and
the fifteen entries after OpenRouter/arXiv are the ones the current corpus was
built from. New candidates live in `EXTRA_SOURCES` and are seeded **disabled**:
this machine cannot verify that a feed is reachable, so the console probes it
and only then does an operator turn it on.

That split is the whole point of putting the catalogue in a table. Without it,
adding a feed means editing a constant and shipping a release, and a new host
missing from `ALLOWED_HOSTS` makes the redirect check reject the source as
`bad_redirect` before any parser runs.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from app.ingest.sources import SOURCE_TIMEOUT_MS, SOURCES

# Frozen. Never reorder or append: `test_sources_parity.py` matches this list
# position by position against the golden fixtures.
SEED_SOURCES: list[dict[str, Any]] = SOURCES

# `family` drives scoring (`rule_score_of`), clustering order and the console's
# grouping; `kind` drives which parser runs.
FAMILIES: tuple[str, ...] = (
    "official",
    "media",
    "community",
    "arxiv",
    "paper",
    "policy",
    "openrouter",
    "huggingface",
    "reference",
)

KINDS: tuple[str, ...] = ("feed", "sitemap", "arxiv", "openrouter", "hf", "hn")

FAMILY_LABELS: dict[str, str] = {
    "openrouter": "模型目录",
    "huggingface": "开源模型库",
    "arxiv": "论文预印本",
    "official": "官方公告",
    "community": "社区讨论",
    "media": "媒体报道",
    "policy": "监管原文",
    "paper": "学术期刊",
    "reference": "参考资料",
}

# Keys with a bespoke parser are reserved: a user-created source may not claim
# `openrouter`, and may not start with `hf-`/`hn-`, because `normalize_results`
# still falls back to key-prefix dispatch for test fixtures.
RESERVED_KEYS = frozenset({"openrouter", "arxiv"})
RESERVED_PREFIXES = ("hf-", "hn-")

KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,46}$")

# ---- archive sources -------------------------------------------------------
# A daily run can only see what a feed still remembers. Hugging Face's
# `trendingScore` list is a fortnight long, and arXiv's `submittedDate` sort stops
# at thirty entries — which is why a sweep of everything before 2025 found 114
# candidates and almost no models: the sources themselves had forgotten.
#
# An archive source answers a different question. `hf-archive` asks for the
# all-time download ranking (bert, gpt2, whisper — the models every later
# generation is measured against), and `arxiv-archive` asks one year at a time
# what its core literature said, rotating one year per backfill so the sweep
# walks 2012 forward instead of re-reading last week.
#
# They are seeded **enabled** but only fetched when the run is historical: the
# `-archive` suffix is the mode switch (`is_archive_source`), and it survives the
# database round trip because `source_dict` returns the key verbatim. A daily run
# would otherwise spend a third of its fetch budget on 2019.
ARCHIVE_SUFFIX = "-archive"
ARCHIVE_TOKEN = "{year}"
ARCHIVE_START_YEAR = 2012

# The archive asks each year one question — "what did the core literature say"
# — and the panel is the filter. The vocabulary is deliberately narrow: a single
# year of cs.AI is tens of thousands of papers, and forty relevance slots have to
# be spent on titles that could plausibly be a milestone. Eight field-defining
# terms beat a bag of superlatives ("breakthrough", "novel") that every abstract
# uses and no landmark title needs.
ARCHIVE_TERMS = "+OR+".join(
    (
        "ti:transformer",
        "ti:attention",
        "ti:diffusion",
        "ti:reinforcement",
        "ti:reasoning",
        "ti:generative",
        "ti:alignment",
        "ti:agent",
    )
)
ARCHIVE_CATEGORIES = "+OR+".join(
    ("cat:cs.AI", "cat:cs.CL", "cat:cs.LG", "cat:cs.MA")
)


def _archive(
    key: str,
    name: str,
    family: str,
    kind: str,
    url: str,
    *,
    rationale: str,
) -> dict[str, Any]:
    """One archival source. Enabled, because the mode already gates it."""
    return {
        "key": key,
        "family": family,
        "name": name,
        "kind": kind,
        "url": url,
        "pathPattern": "/news/",
        "timeout": SOURCE_TIMEOUT_MS,
        "domestic": False,
        "aiOnly": False,
        "enabled": True,
        "verified": True,
        "weight": 200,
        "rationale": rationale,
    }


ARCHIVE_SOURCES: list[dict[str, Any]] = [
    _archive(
        "hf-archive",
        "Hugging Face 全时下载榜",
        "huggingface",
        "hf",
        "https://huggingface.co/api/models?sort=downloads&direction=-1&limit=100",
        rationale=(
            "按历史累计下载排序，得到 bert/gpt2/t5/whisper 这类定义过后继基准的老模型；"
            "trending 榜只看近两周，日常运行永远看不到它们。"
        ),
    ),
    _archive(
        "arxiv-archive",
        "arXiv 按年检索",
        "arxiv",
        "arxiv",
        (
            "https://export.arxiv.org/api/query?search_query="
            f"({ARCHIVE_TERMS})+AND+({ARCHIVE_CATEGORIES})+"
            "AND+submittedDate:[{year}01010000+TO+{year}12312359]"
            "&sortBy=relevance&sortOrder=descending&max_results=40"
        ),
        rationale=(
            "按年取当年核心主题的 40 篇，每轮回补只推进一年（2012 起），"
            "用来找回预先印本排序（只给最新三十篇）永远拿不到的历史里程碑。"
        ),
    ),
]


def is_archive_source(source: dict[str, Any]) -> bool:
    """Is this source only fetched by a historical run?"""
    return str(source.get("key") or "").endswith(ARCHIVE_SUFFIX)


def archive_years(now_year: int) -> tuple[int, ...]:
    """Every year the archive may ask for: 2012 up to the year before `now`."""
    return tuple(range(ARCHIVE_START_YEAR, max(ARCHIVE_START_YEAR, now_year)))


def archive_year_for(turn: int, now_year: int) -> int:
    """The year this run owns. `turn` grows by one per backfill."""
    years = archive_years(now_year)
    return years[turn % len(years)]


def resolve_archive_source(source: dict[str, Any], year: int) -> dict[str, Any]:
    """Copy of `source` with `{year}` filled in. A no-op for a fixed URL."""
    url = str(source.get("url") or "")
    if ARCHIVE_TOKEN not in url:
        return source
    return {**source, "url": url.replace(ARCHIVE_TOKEN, str(year))}



def _extra(
    key: str,
    name: str,
    family: str,
    kind: str,
    url: str,
    *,
    rationale: str,
    ai_only: bool = False,
    domestic: bool = False,
    path_pattern: str = "/news/",
    timeout: int = SOURCE_TIMEOUT_MS,
    weight: int = 100,
) -> dict[str, Any]:
    """One unverified candidate. `enabled=False` until the console probes it."""
    return {
        "key": key,
        "family": family,
        "name": name,
        "kind": kind,
        "url": url,
        "pathPattern": path_pattern,
        "timeout": timeout,
        "domestic": domestic,
        "aiOnly": ai_only,
        "enabled": False,
        "verified": False,
        "weight": weight,
        "rationale": rationale,
    }


EXTRA_SOURCES: list[dict[str, Any]] = [
    # ----- official labs and vendors ---------------------------------------
    _extra(
        "meta-ai",
        "Meta AI Blog",
        "official",
        "feed",
        "https://ai.meta.com/blog/rss/",
        rationale="一线实验室的一手发布；官方公告是唯一能定调时间线的证据。",
    ),
    _extra(
        "msr",
        "Microsoft Research",
        "official",
        "feed",
        "https://www.microsoft.com/en-us/research/feed/",
        rationale="研究院博客，含模型与系统成果；非 AI 条目噪声高，按 AI 相关过滤。",
        ai_only=True,
    ),
    _extra(
        "nvidia",
        "NVIDIA Blog",
        "official",
        "feed",
        "https://blogs.nvidia.com/feed/",
        rationale="算力与推理栈的一手信息，硬件侧时间线的锚点；需过滤非 AI 内容。",
        ai_only=True,
    ),
    _extra(
        "mistral",
        "Mistral News",
        "official",
        "sitemap",
        "https://mistral.ai/news",
        rationale="欧洲头部模型厂商，无 RSS，用 sitemap 抓 /news/ 路径。",
    ),
    _extra(
        "xai",
        "xAI News",
        "official",
        "sitemap",
        "https://x.ai/news",
        rationale="Grok 系列的官方发布，sitemap 覆盖新闻页。",
    ),
    _extra(
        "qwen-blog",
        "Qwen Blog",
        "official",
        "feed",
        "https://qwenlm.github.io/blog/index.xml",
        rationale="通义千问官方技术博客，Atom 全文。",
    ),
    _extra(
        "deepseek",
        "DeepSeek News",
        "official",
        "sitemap",
        "https://api-docs.deepseek.com/news",
        rationale="DeepSeek 官方发布集中在此文档站，无 RSS，按 sitemap 抓取。",
    ),
    _extra(
        "zhipu",
        "智谱新闻",
        "official",
        "sitemap",
        "https://www.zhipuai.cn/zh/news",
        rationale="国内头部模型厂商官方动态，中文一手源。",
        domestic=True,
    ),
    _extra(
        "moonshot",
        "月之暗面",
        "official",
        "sitemap",
        "https://www.moonshot.cn/news",
        rationale="Kimi 官方发布，中文一手源。",
        domestic=True,
    ),
    _extra(
        "minimax",
        "MiniMax 新闻",
        "official",
        "sitemap",
        "https://www.minimaxi.com/news",
        rationale="MiniMax 官方发布，中文一手源。",
        domestic=True,
    ),
    # ----- Chinese and trade media -----------------------------------------
    _extra(
        "jiqizhixin",
        "机器之心",
        "media",
        "feed",
        "https://www.jiqizhixin.com/rss",
        rationale="国内 AI 垂直媒体，覆盖面广；作为二手证据用于交叉验证。",
        domestic=True,
    ),
    _extra(
        "36kr",
        "36氪",
        "media",
        "feed",
        "https://36kr.com/feed",
        rationale="创投与产业媒体，补充商业化视角；必须过滤非 AI 条目。",
        domestic=True,
        ai_only=True,
    ),
    _extra(
        "huxiu",
        "虎嗅",
        "media",
        "feed",
        "https://www.huxiu.com/rss/0.xml",
        rationale="产业分析向媒体，用于观察舆论与产业解读；非一手证据。",
        domestic=True,
        ai_only=True,
    ),
    _extra(
        "sspai",
        "少数派",
        "media",
        "feed",
        "https://sspai.com/feed",
        rationale="产品与工具视角，补 AI 消费端落地；非 AI 条目全部过滤。",
        domestic=True,
        ai_only=True,
    ),
    _extra(
        "ifanr",
        "爱范儿",
        "media",
        "feed",
        "https://www.ifanr.com/feed",
        rationale="科技消费媒体，补端侧与产品发布信息；非 AI 条目全部过滤。",
        domestic=True,
        ai_only=True,
    ),
    _extra(
        "venturebeat-ai",
        "VentureBeat AI",
        "media",
        "feed",
        "https://venturebeat.com/category/ai/feed/",
        rationale="英文企业级 AI 报道，补企业采购与落地案例。",
    ),
    _extra(
        "ieee-spectrum-ai",
        "IEEE Spectrum AI",
        "media",
        "feed",
        "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss",
        rationale="工程界视角的深度报道，质量稳定，用于交叉验证。",
    ),
    # ----- academic --------------------------------------------------------
    _extra(
        "nature-ai",
        "Nature AI",
        "paper",
        "feed",
        "https://www.nature.com/subjects/artificial-intelligence.rss",
        rationale="同行评议的顶刊栏目，补预印本之外的正式发表证据。",
    ),
    _extra(
        "science-news",
        "Science News",
        "paper",
        "feed",
        "https://www.science.org/rss/news_current.xml",
        rationale="综合科学新闻，仅取 AI 相关条目。",
        ai_only=True,
    ),
    # ----- policy and standards -------------------------------------------
    _extra(
        "nist",
        "NIST News",
        "policy",
        "feed",
        "https://www.nist.gov/news-events/news/rss.xml",
        rationale="美国标准与评测机构，AI 安全与测评框架的一手发布。",
    ),
    _extra(
        "eu-digital",
        "EU Digital Strategy",
        "policy",
        "feed",
        "https://digital-strategy.ec.europa.eu/en/rss.xml",
        rationale="欧盟数字政策一手发布，AI Act 实施细则的原文来源。",
    ),
    _extra(
        "oecd-ai",
        "OECD.AI",
        "policy",
        "feed",
        "https://oecd.ai/en/wonk/rss.xml",
        rationale="跨国组织的 AI 政策观察，用于对照各国监管口径。",
    ),
]

# Seed first, extras second, archives last: the console lists them in this order
# until an operator sets a different `weight`.
CATALOG_SEED: list[dict[str, Any]] = [*SEED_SOURCES, *EXTRA_SOURCES, *ARCHIVE_SOURCES]


def validate_key(key: str) -> str:
    """Return a normalised key or raise `ValueError` with a readable reason."""
    candidate = (key or "").strip().lower()
    if not KEY_RE.match(candidate):
        raise ValueError("key 只能是小写字母、数字与连字符，2–47 字符，且以字母或数字开头")
    if candidate in RESERVED_KEYS:
        raise ValueError(f"key `{candidate}` 已被内置解析器占用")
    if candidate.startswith(RESERVED_PREFIXES):
        raise ValueError("key 不能以 hf- 或 hn- 开头（与内置解析器前缀冲突）")
    return candidate


def hosts_of(sources: list[dict[str, Any]]) -> set[str]:
    """Hostnames of the *configured* URLs. Never derived from item URLs: a
    poisoned feed would then be able to point the crawler anywhere."""
    hosts: set[str] = set()
    for source in sources:
        url = source.get("url") or ""
        try:
            host = (urlparse(url).hostname or "").lower()
        except ValueError:
            continue
        if host:
            hosts.add(host)
    return hosts
