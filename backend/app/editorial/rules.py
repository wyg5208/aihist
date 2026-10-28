"""Deterministic editorial rules, ported from functions/lib/editorial.mjs.

This pass never admits an entry: it rejects obvious news, scores what is left
and decides which candidates are worth a paid panel. The regexes carry the
whole policy, so they are kept one-to-one with the reference implementation.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.ingest.regexes import compile_ascii

Candidate = dict[str, Any]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# v2: the panel moved from three judges / two votes to five vendors / three
# votes. The bump is what retires the cached v1 ballots, so decisions taken
# under the old quorum are re-reviewed instead of reused.
# v3: the `policy` family scores as a primary source, so regulatory feeds are no
# longer scored as media. The bump retires every cached v2 ballot for the same
# reason: a score computed under the old weights cannot be reused for the new
# rubric. Rollback is `policy` out of three places + this constant back to v2;
# `collect_verdicts` keeps the history either way, because that is data, not a
# rule.
# v4: a catalogue model is now shown to the panel as its vendor model card rather
# than a template that listed the context window and nothing else, and a tier
# suffix costs 4 points instead of 8. Both change what a cached ballot was a
# judgement *about*, so every cached verdict has to be re-taken; without the bump
# the 148 model releases the panel filed as 「仅目录条目」 would stay excluded
# forever, because a decision is reused whenever its rubric version matches.
# v5: a generation now admits its first tier at 75 and charges every further
# tier 5 more points (see `tier_line`), so a family that ships four SKUs in a
# week no longer fills four slots. The bump retires the v4 ballots for the same
# reason as before: a verdict taken without knowing which tier the candidate
# was competing for cannot be reused under a rubric that counts tiers.
RUBRIC_VERSION = "chronicle-v5"
INCLUDE_SCORE = 75
# One judge per domestic vendor: DeepSeek, Qwen, GLM, Kimi, MiniMax. Five
# vendors rather than five copies of one model, so no single vendor's bias can
# carry a decision.
PANEL_SIZE = 5
# A bare majority. Two outages still leave a decisive three-vote quorum, while a
# 2-2 split holds instead of being broken by whichever judge answered first.
MIN_INCLUDE_VOTES = 3
RULE_PANEL_THRESHOLD = 35
RULE_AUDIT_THRESHOLD = 25

# ---- the generation ladder -------------------------------------------------
# A generation's flagship is the event; its second tier is a product line and
# its third is marketing. `rule_score_of` already charges a tier suffix four
# points, which is enough to keep a family off the top of the queue but not
# enough to separate one that ships four tiers in a week: they all land in the
# same 75-82 band and the panel admits them in whatever order it happens to
# read them.
#
# So the count is charged after the ballots, against the panel's own median:
# the first tier of a generation needs 75, the second 80, the third 85, and so
# on, capped at 95. The score that decides is still the panel's; the ladder only
# decides how many members of one generation may pass. `None` here means no
# model has been admitted for that generation yet.
TIER_LINE_STEP = 5
TIER_LINE_CAP = 95

HARD_RULES: list[dict[str, Any]] = [
    {
        "key": "funding",
        "label": "融资、估值与资本事件",
        "pattern": compile_ascii(r"融资|募资|估值|亿元|千万美元|亿美元|[A-E]轮|IPO|上市|收购|并购|股价|市值|投资机构"),
    },
    {
        "key": "personnel",
        "label": "人事、裁员与组织变动",
        "pattern": compile_ascii(r"任命|离职|裁员|加盟|出任|晋升|招聘|高管变动|人事变动"),
    },
    {
        "key": "business",
        "label": "合作、客户案例与商业落地",
        "pattern": compile_ascii(r"赋能|助力|落地|客户案例|签约|合作|共建|联合发布|生态伙伴|应用场景|试点|商业化"),
    },
    {
        "key": "availability",
        "label": "可用性、价格与区域开放",
        "pattern": compile_ascii(r"正式可用|开放使用|开放注册|免费额度|降价|促销|订阅|套餐|灰度|地区上线|区域上线"),
    },
    {
        "key": "event",
        "label": "发布会、大会与直播预告",
        "pattern": compile_ascii(r"前瞻|预告|直播|发布会|大会|论坛|沙龙|圆桌|举行|举办|召开|议程|报名|成功举办"),
    },
    {
        "key": "opinion",
        "label": "访谈、评论与预测",
        # "预测" is deliberately absent: protein-structure and weather prediction
        # are research subjects, not opinion pieces. The panel handles forecasts.
        "pattern": compile_ascii(
            r"专访|访谈|对话(?!模型|式|能力)|观点|演讲|专栏|评论|解读|复盘|思考|展望|"
            r"为什么|如何|究竟|吗？|？|谁在|谁先"
        ),
    },
    {
        "key": "roundup",
        "label": "早报、榜单与教程",
        "pattern": compile_ascii(
            r"早报|日报|周报|晚报|快讯|盘点|一览|汇总|榜单|排名|TOP\s*\d|十大|教程|入门|实战|踩坑|测评|对比评测"
        ),
    },
    {
        "key": "rumor",
        "label": "传闻与未经证实的信息",
        "pattern": compile_ascii(r"传闻|爆料|据悉|消息称|知情人士|匿名|或将|有望"),
    },
    {
        "key": "business-metric",
        "label": "营收、流量与营销数据",
        "pattern": compile_ascii(
            r"营收|利润|销量|日活|月活|GMV|股价|市值|市场份额|订单量|带货|电商|双11|618|营销|流量|变现|付费用户"
        ),
    },
]

POLICY_SUMMIT = compile_ascii(r"安全峰会|治理峰会|人工智能峰会|AI\s*峰会|AI\s*安全|国际人工智能安全")

MAJOR_MODEL = compile_ascii(
    r"(?:gpt|claude|gemini|llama|qwen|deepseek|glm|kimi|grok|mistral|mixtral|palm|gemma|phi|"
    r"command|minimax|doubao|hunyuan|ernie|step|spark|mimo|ling|nemotron|fugu|solar|muse|helix|"
    r"sora|veo|whisper)[\s-]?(?:v)?\d+(?:\.\d+)?",
    re.I,
)

NOVELTY = compile_ascii(
    r"首次|首个|第一次|首款|开源|新架构|新范式|新代际|突破|刷新|超越|纪录|里程碑|发布|推出|问世|"
    r"诞生|生效|签署|判决|禁令|框架|标准|白皮书|法案|监管|政策|open[- ]?source|first|record|"
    r"breakthrough|state[- ]of[- ]the[- ]art|release|introduc",
    re.I,
)

BINDING_POLICY = compile_ascii(
    r"生效|签署|通过|判决|禁令|法案|条例|法规|管理办法|监管规定|正式实施|"
    r"\b(?:act|law|regulation|ruling|ban|executive order)\b",
    re.I,
)

_DECIMAL_VERSION = compile_ascii(r"\d+\.\d+")


def evidence_of(candidate: Candidate) -> list[dict[str, Any]]:
    evidence = candidate.get("evidence")
    return evidence if isinstance(evidence, list) else []


def family_list_of(candidate: Candidate) -> list[str]:
    families: list[str] = []
    for family in candidate.get("families") or []:
        if family not in families:
            families.append(family)
    for source in evidence_of(candidate):
        family = source.get("family") if isinstance(source, dict) else None
        if family and family not in families:
            families.append(family)
    return families


def source_names_of(candidate: Candidate) -> list[str]:
    names: list[str] = []
    for source in evidence_of(candidate):
        name = source.get("name") if isinstance(source, dict) else None
        if name and name not in names:
            names.append(name)
    return names


def _is_rule_skipped(rule: dict[str, Any], category: str, title: str) -> bool:
    # A summit that produces a binding agreement is a policy event, not an
    # event preview. The panel still has to approve it.
    if rule["key"] == "event" and category == "policy" and POLICY_SUMMIT.search(title):
        return True
    return False


def hard_flags_for(candidate: Candidate) -> list[dict[str, str]]:
    title = f"{candidate.get('title') or ''} {candidate.get('titleEn') or ''}"
    category = candidate.get("category") or "policy"
    return [
        {"key": rule["key"], "label": rule["label"]}
        for rule in HARD_RULES
        if rule["pattern"].search(title) and not _is_rule_skipped(rule, category, title)
    ]


def has_tier_variant(candidate: Candidate) -> bool:
    family_key = candidate.get("familyKey")
    model_key = candidate.get("modelKey")
    return bool(family_key and model_key and family_key != model_key)


def tier_line(ordinal: int) -> int:
    """Score the `ordinal`-th admitted tier of a generation has to reach.

    Ordinals start at 1, so the flagship is charged exactly `INCLUDE_SCORE` and
    the ladder is a pure addition on top of the existing rule — a generation
    with one member behaves as it did under v4.
    """
    if ordinal <= 1:
        return INCLUDE_SCORE
    return min(TIER_LINE_CAP, INCLUDE_SCORE + TIER_LINE_STEP * (ordinal - 1))


def generation_of(candidate: Candidate) -> str:
    """The key whose tiers compete with each other, or `""` if it has none.

    Only a model release has a generation. A policy or a research milestone is
    a one-off: two of them in a year are two events, not two SKUs.
    """
    if candidate.get("category") != "model":
        return ""
    return str(candidate.get("familyKey") or candidate.get("modelKey") or "")


def apply_tier_lines(
    by_id: dict[str, dict[str, Any]],
    candidates: list[Candidate],
    admitted_tiers: dict[str, int] | None = None,
) -> dict[str, dict[str, Any]]:
    """Charge each further tier of a generation a higher score than the last.

    `by_id` is the panel's aggregate (`fingerprint` -> outcome) and is updated
    in place; `admitted_tiers` counts the tiers each generation already has in
    the archive, so the ladder survives across runs. Members of one generation
    are ranked by median score, best first: a candidate that clears its line
    takes the seat, and one that does not leaves the seat to its siblings rather
    than blocking them.

    A candidate the panel *wanted* but the ladder held back becomes `hold`, not
    `exclude`. The ordinal is not stable — the next run may rank the siblings
    differently — so caching a rejection taken against a seat number that can
    still move would be wrong. A panel rejection is left alone: a higher bar
    never rescues a candidate the panel already turned down.
    """
    seats = dict(admitted_tiers or {})
    groups: dict[str, list[str]] = {}
    for candidate in candidates:
        fingerprint = candidate.get("fingerprint")
        key = generation_of(candidate)
        if not fingerprint or not key or fingerprint not in by_id:
            continue
        groups.setdefault(key, []).append(fingerprint)

    for key, fingerprints in groups.items():
        seat = seats.get(key, 0)
        ranked = sorted(
            fingerprints,
            key=lambda fp: (-(by_id[fp].get("score") or 0), fp),
        )
        for fingerprint in ranked:
            outcome = by_id[fingerprint]
            ordinal = seat + 1
            line = tier_line(ordinal)
            outcome["tierOrdinal"] = ordinal
            outcome["tierLine"] = line
            if outcome.get("decision") == "include":
                if (outcome.get("score") or 0) >= line:
                    seat = ordinal
                else:
                    outcome["decision"] = "hold"
                    outcome["tierHeld"] = True
        seats[key] = seat

    return by_id


def _number(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def rule_score_of(candidate: Candidate) -> int:
    families = family_list_of(candidate)
    names = source_names_of(candidate)
    title = f"{candidate.get('title') or ''} {candidate.get('titleEn') or ''}"
    signals = candidate.get("signals") or {}
    score = 25

    if len(families) >= 2:
        score += 18
    if len(families) >= 3:
        score += 7
    if "official" in families:
        score += 10
    # A regulator's own text is first-hand like an official announcement, and the
    # whole point of adding the family is that it should not be scored as media.
    if "policy" in families:
        score += 10
    if "arxiv" in families or "paper" in families:
        score += 6
    if "openrouter" in families or "huggingface" in families:
        score += 4

    if signals.get("headLab"):
        score += 8
    hn = _number(signals.get("hnPoints"))
    if hn >= 500:
        score += 12
    elif hn >= 250:
        score += 7
    elif hn >= 120:
        score += 3
    likes = _number(signals.get("hfLikes"))
    if likes >= 1000:
        score += 6
    elif likes >= 300:
        score += 3
    if signals.get("notableOfficial"):
        score += 8

    if NOVELTY.search(title):
        score += 10
    if BINDING_POLICY.search(title) and candidate.get("category") == "policy":
        score += 10

    if candidate.get("category") == "model" and MAJOR_MODEL.search(title):
        # A tier suffix costs half of what it used to. At -8 the penalty fired on
        # every member of a family — `Gemini 3.8 Flash` is the flagship of its
        # generation, but the catalogue rarely lists the `Pro` it would be
        # redundant with, so the only entry the family had was the one penalised,
        # and 33 points kept it off the ballot entirely. The handicap still
        # applies, it just no longer decides on its own; -4 leaves the candidate
        # above `RULE_PANEL_THRESHOLD` for the panel to judge on the model card.
        score += -4 if has_tier_variant(candidate) else 6
    if _DECIMAL_VERSION.search(candidate.get("modelName") or ""):
        score -= 4

    if len(families) == 1 and families[0] == "media":
        # Two independent outlets are meaningful corroboration even though they
        # share a source family. A single domestic analysis piece is not.
        if len(names) >= 2:
            score += 10
        else:
            score -= 12
    if len(families) == 1 and families[0] == "arxiv":
        score -= 8
    if len(families) == 1 and families[0] in ("openrouter", "huggingface"):
        score -= 2
    if (candidate.get("sourceCount") or len(evidence_of(candidate))) >= 2:
        score += 4

    return max(0, min(100, score))


def assess_candidate(candidate: Candidate) -> dict[str, Any]:
    """Deterministic first pass; it never admits an entry on its own."""
    flags = hard_flags_for(candidate)
    score = rule_score_of(candidate)
    families = family_list_of(candidate)
    names = source_names_of(candidate)
    reasons = [flag["label"] for flag in flags]
    if len(families) == 1 and families[0] == "media" and len(names) < 2:
        reasons.append("单一媒体来源")
    if len(families) == 1 and families[0] == "arxiv":
        reasons.append("单篇预印本")
    if has_tier_variant(candidate):
        reasons.append("同族包装变体")

    deduped: list[str] = []
    for reason in reasons:
        if reason not in deduped:
            deduped.append(reason)

    return {
        "score": score,
        "flags": flags,
        "reasons": deduped,
        "disqualify": flags[0]["key"] if flags else None,
        "eligible": not flags and score >= RULE_PANEL_THRESHOLD,
        "families": families,
        "sourceNames": names,
    }


def tier_line_note(outcome: dict[str, Any]) -> str:
    """Why a panel-approved model is still waiting: the seat, the line, the score."""
    ordinal = outcome.get("tierOrdinal") or 1
    line = outcome.get("tierLine")
    if line is None:
        return ""
    return f"同代第 {ordinal} 档需 {line} 分，本轮中位 {outcome.get('score') or 0} 分"


def should_audit_out(assessment: dict[str, Any]) -> bool:
    if assessment.get("disqualify"):
        return True
    return assessment["score"] < RULE_AUDIT_THRESHOLD


def rule_decision(candidate: Candidate, assessment: dict[str, Any]) -> dict[str, Any]:
    return {
        "decision": "exclude",
        "score": assessment["score"],
        "includeVotes": 0,
        "excludeVotes": 0,
        "validVotes": 0,
        "votes": [
            {
                "judge": "rule",
                "model": "deterministic",
                "score": assessment["score"],
                "vote": "exclude",
                "flags": [flag["key"] for flag in assessment["flags"]],
                "reason": "、".join(assessment["reasons"]) or "低于编年史门槛",
            }
        ],
    }


def decision_record(
    candidate: Candidate,
    outcome: dict[str, Any],
    *,
    run_id: uuid.UUID | None = None,
    source: str = "panel",
    now: datetime | None = None,
) -> dict[str, Any]:
    """One row for `review_decisions`.

    The values are already in column form (a real datetime and a real UUID) so
    the caller can hand the dict straight to an insert.
    """
    stamp = now or utc_now()
    return {
        "id": candidate["fingerprint"],
        "fingerprint": candidate["fingerprint"],
        "rubric_version": RUBRIC_VERSION,
        "decision": outcome["decision"],
        "score": outcome["score"],
        "include_votes": outcome["includeVotes"],
        "valid_votes": outcome["validVotes"],
        "votes": outcome.get("votes") or [],
        "title": str(candidate.get("title") or "")[:300],
        "category": candidate.get("category") or "policy",
        "source_count": candidate.get("sourceCount") or len(evidence_of(candidate)),
        "decision_source": source,
        "run_id": run_id,
        "decided_at": stamp,
        "updated_at": stamp,
    }


def review_summary(outcome: dict[str, Any], source: str = "panel") -> dict[str, Any]:
    from app.domain.text import iso_now

    return {
        "version": RUBRIC_VERSION,
        "source": source,
        "decision": outcome["decision"],
        "score": outcome["score"],
        "includeVotes": outcome["includeVotes"],
        "validVotes": outcome["validVotes"],
        "votes": [
            {
                "judge": vote.get("judge"),
                "model": vote.get("model"),
                "score": vote.get("score"),
                "vote": vote.get("vote"),
                "reason": vote.get("reason") or "",
                "flags": vote.get("flags") or [],
            }
            for vote in outcome.get("votes") or []
        ],
        "at": iso_now(),
    }
