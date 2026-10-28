"""The vocabulary of collection verdicts, in one place.

Every place that can discard an item writes one of these codes, and both the
API and the console render the Chinese label from here. Keeping the list in the
backend means a new drop reason needs exactly one edit plus a test, and the
`GET /library/reasons` endpoint can report counts for codes the UI has never
heard of instead of silently dropping them.
"""

from __future__ import annotations

# Pipeline stages. Ordered: the console draws the funnel in this order.
STAGES: tuple[str, ...] = (
    "fetch",
    "normalize",
    "cap",
    "cluster",
    "rule",
    "panel",
    "manual",
    "dedup",
)

# Dispositions. `pending` means "collected, not yet judged" — it is what the
# first ledger flush writes, so a crashed run still shows its intake.
STATUSES: tuple[str, ...] = ("pending", "admitted", "excluded", "held", "dropped")

# code -> (stage, label). The code is the contract (filter parameter, stored
# value); the label is display only and may be reworded.
REASONS: dict[str, tuple[str, str]] = {
    # ----- normalize: the item never became a candidate ---------------------
    "date_missing": ("normalize", "缺发布时间"),
    "window_age": ("normalize", "超出时间窗"),
    "title_too_short": ("normalize", "标题过短"),
    "ai_only_miss": ("normalize", "非 AI 相关"),
    "topic_gate": ("normalize", "主题不匹配"),
    "model_filter": ("normalize", "模型条目不适用"),
    "below_likes": ("normalize", "热度不足"),
    # ----- cluster ---------------------------------------------------------
    "duplicate": ("cluster", "重复证据"),
    "below_keep": ("cluster", "未过聚类可信度门槛"),
    # ----- caps ------------------------------------------------------------
    "cap_raw": ("cap", "原始上限截断"),
    "cap_events": ("cap", "新事件上限"),
    # ----- rules and panel -------------------------------------------------
    "score_low": ("rule", "规则分不足"),
    "panel:exclude": ("panel", "面板否决"),
    "panel:hold": ("panel", "面板暂缓"),
    "panel:unconfigured": ("panel", "面板未配置"),
    "deferred": ("panel", "批次上限顺延"),
    "admitted": ("panel", "已纳入"),
    # ----- migration 0005: rows that predate the ledger ---------------------
    # Not a verdict anyone took. Those items were collected before `status`
    # existed, so calling them `pending` would promise a decision that can
    # never arrive. The label is deliberately plain: it names the era, not a
    # judgement.
    "legacy_pre_ledger": ("fetch", "账本上线前采集"),
}

# `rule:<key>` borrows the hard-rule key as its suffix, and `manual:<action>`
# records an operator override. Both are resolved by `label_of` rather than
# enumerated, because the sets live in `editorial/rules.py` and in the decision
# endpoint respectively.
RULE_PREFIX = "rule:"
MANUAL_PREFIX = "manual:"

# Why a batch of items waited: the console shows these on the "待定" tile so an
# operator can tell "the panel voted hold" from "we never got a quorum".
HOLD_REASONS = frozenset({"panel:hold", "panel:unconfigured", "deferred", "score_low"})

_HARD_RULE_LABELS = {
    "funding": "融资与估值",
    "personnel": "人事变动",
    "business": "商务与合作",
    "availability": "涨价、限流与可用性",
    "event": "活动与议程",
    "opinion": "观点与预测",
    "roundup": "汇总与盘点",
    "rumor": "传闻与爆料",
    "business-metric": "经营数字",
}

_MANUAL_LABELS = {
    "admit": "人工纳入",
    "exclude": "人工排除",
    "hold": "人工暂缓",
    "re-review": "人工重审",
}


def label_of(code: str) -> str:
    """Human label for a reason code. Unknown codes return themselves."""
    if not code:
        return ""
    known = REASONS.get(code)
    if known is not None:
        return known[1]
    if code.startswith(RULE_PREFIX):
        key = code[len(RULE_PREFIX) :]
        return f"硬性排除：{_HARD_RULE_LABELS.get(key, key)}"
    if code.startswith(MANUAL_PREFIX):
        action = code[len(MANUAL_PREFIX) :]
        return _MANUAL_LABELS.get(action, f"人工改判：{action}")
    return code


def stage_of(code: str) -> str:
    """Stage a code belongs to. Used to fill `raw_items.stage` when only the
    code is known at the call site."""
    known = REASONS.get(code)
    if known is not None:
        return known[0]
    if code.startswith(RULE_PREFIX):
        return "rule"
    if code.startswith(MANUAL_PREFIX):
        return "manual"
    return ""


def all_codes() -> list[str]:
    """Every static code, in stage order. Rule and manual codes are dynamic."""
    ordered = {stage: index for index, stage in enumerate(STAGES)}
    return sorted(REASONS, key=lambda code: (ordered[REASONS[code][0]], code))
