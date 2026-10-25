"""The published editorial standard, ported from functions/lib/editorial.mjs."""

from __future__ import annotations

from typing import Any

from app.editorial.rules import (
    HARD_RULES,
    INCLUDE_SCORE,
    MIN_INCLUDE_VOTES,
    PANEL_SIZE,
    RUBRIC_VERSION,
)

STANDARD: dict[str, Any] = {
    "version": RUBRIC_VERSION,
    "includeScore": INCLUDE_SCORE,
    "panelSize": PANEL_SIZE,
    "minVotes": MIN_INCLUDE_VOTES,
    "principle": (
        "记录改变 AI 能力边界、成本曲线、竞争格局或治理规则，并能在多年后被引用的事件。"
        "日常新闻、产品动态与观点聚合不进入编年史。"
    ),
    "gates": [
        {
            "title": "主体与时点明确",
            "detail": "能定位到具体机构、模型、政策或研究，日期精度不低于月。",
        },
        {
            "title": "与 AI 发展直接相关",
            "detail": "变化发生在 AI 技术、产品、研究或治理本身，而不是公司综合新闻里顺带提到 AI。",
        },
        {
            "title": "证据可核验",
            "detail": (
                "至少一条一手证据（官方公告、论文、监管原文、模型目录），"
                "或两个独立来源对同一事实的独立报道。"
            ),
        },
        {
            "title": "有历史增量",
            "detail": "带来新能力、新范式、新规模、新规则或新纪录，而不是既有事物的例行更新。",
        },
        {
            "title": "一年后仍可引用",
            "detail": "能作为某条发展线的节点被再次引用，而不是当日热点、股价反应或营销活动。",
        },
    ],
    "dimensions": [
        {"name": "历史意义", "weight": 30, "detail": "是否改变能力边界、成本曲线、竞争格局或治理规则。"},
        {"name": "一手证据", "weight": 20, "detail": "官方、论文、监管原文或独立交叉报道的强度。"},
        {"name": "增量", "weight": 20, "detail": "新能力、新范式、新规模或新规则的程度。"},
        {"name": "持久引用", "weight": 20, "detail": "一年后是否仍会被当作节点引用。"},
        {"name": "非新闻性", "weight": 10, "detail": "是否脱离融资、人事、促销、发布会与热点周期。"},
    ],
    "hardRejects": [{"key": rule["key"], "label": rule["label"]} for rule in HARD_RULES],
    "panel": {
        "size": PANEL_SIZE,
        "minVotes": MIN_INCLUDE_VOTES,
        "temperature": 0,
        "detail": (
            f"{PANEL_SIZE} 家不同厂商的模型使用同一 rubric 分别打分并投票；"
            f"至少 {MIN_INCLUDE_VOTES} 票 include 且分数不低于 {INCLUDE_SCORE} 才入档。"
            "票型分裂、有效票不足或调用失败时暂缓，不发布。"
        ),
    },
    "decisions": {
        "include": f"{MIN_INCLUDE_VOTES} 票及以上同意，分数达到门槛，写入时间轴。",
        "exclude": f"{MIN_INCLUDE_VOTES} 票及以上反对，或命中硬性排除，不写入；保留评审记录。",
        "hold": f"有效票不足 {MIN_INCLUDE_VOTES} 票或票型分裂，暂缓且不显示。",
    },
}
