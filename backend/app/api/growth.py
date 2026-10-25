"""Public subscribe, confirm and unsubscribe.

Double opt-in without a mailer.

The console does not send email — see Settings, which says so plainly — so the
confirmation link is returned in the subscribe response and shown to the reader
in the browser. In a deployment that does have an outbound mail tool, the
operator takes the exported list and sends `confirmUrl` themselves. That keeps
deliverability, bounces and complaints outside this application while still
producing a consent record that means something: `status='confirmed'` only ever
comes from someone following the link.

Nothing here is authenticated and nothing here reveals whether an address is
already on the list beyond the status of the address the caller just typed.
"""

from __future__ import annotations

import html
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.channels import classify_channel, host_of
from app.config import Settings, get_settings
from app.db import repo_growth
from app.deps import get_session

router = APIRouter()

MAX_SOURCE_PATH = 200


class SubscribeRequest(BaseModel):
    model_config = {"populate_by_name": True}

    email: str = ""
    # Explicit, and required: an address typed into a box is not consent, a
    # checkbox is. The column that records it is a timestamp, not a flag.
    consent: bool = False
    source_path: str = Field(default="", alias="sourcePath")


def confirm_url(settings: Settings, token: str) -> str:
    return f"{settings.site_origin.rstrip('/')}/api/v1/subscribe/confirm?token={token}"


# ---------------------------------------------------------------------------
# The reader-facing page
# ---------------------------------------------------------------------------

# Inline CSS and no external anything: this page is opened from an email client
# and must render with no scripts, no fonts to fetch and no build step.
_PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light dark">
<title>{title} · AI 纪年</title>
<style>
  :root {{
    --page: #f6f2e9; --ink: #1d1b17; --dim: #5f5850; --rule: #d8cfbe; --accent: #9c3a27;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --page: #14120f; --ink: #e8e2d6; --dim: #9a938a; --rule: #2e2a24; --accent: #d4806a;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    padding: 2rem 1.25rem; background: var(--page); color: var(--ink);
    font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif; line-height: 1.7;
  }}
  main {{ width: 100%; max-width: 30rem; }}
  .mark {{
    font: 0.68rem/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--dim);
  }}
  h1 {{ margin: 0.9rem 0 0.75rem; font-size: 1.35rem; font-weight: 400; letter-spacing: 0.01em; }}
  p {{ margin: 0.6rem 0; font-size: 0.92rem; color: var(--dim); }}
  .rule {{ height: 1px; background: var(--rule); margin: 1.4rem 0; border: 0; }}
  a {{ color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; }}
  .note {{ font-size: 0.8rem; color: var(--dim); }}
</style>
</head>
<body>
<main>
  <p class="mark">AI 纪年 · 简报名单</p>
  <h1>{heading}</h1>
  {body}
  <hr class="rule">
  <p class="note">本页不承担订阅以外的作用，也没有任何追踪脚本。<a href="/">回到站点</a></p>
</main>
</body>
</html>
"""


def _page(
    *, title: str, heading: str, body: str, status_code: int = 200
) -> HTMLResponse:
    document = _PAGE.format(
        title=html.escape(title),
        heading=html.escape(heading),
        body=body,
    )
    return HTMLResponse(
        content=document,
        status_code=status_code,
        headers={
            "cache-control": "no-store",
            # Belt as well as braces: the meta tag is the one that travels with
            # the document, this is the one a well-behaved crawler honours first.
            "x-robots-tag": "noindex, nofollow",
            "referrer-policy": "no-referrer",
        },
    )


def _invalid_link() -> HTMLResponse:
    return _page(
        title="链接无效",
        heading="这个链接无效或已过期",
        body="<p>确认与退订链接都只对一条订阅记录有效。若你刚提交过邮箱，可以回到站点重新填写。</p>",
        status_code=404,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/subscribe")
async def subscribe(
    payload: SubscribeRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Record intent. Repeats are idempotent — a known address keeps its row."""
    if not payload.consent:
        raise HTTPException(status_code=400, detail="consent_required")
    if not repo_growth.looks_like_email(payload.email):
        raise HTTPException(status_code=400, detail="invalid_email")

    email = repo_growth.normalize_email(payload.email)
    row = await repo_growth.find_by_email(session, email)
    if row is None:
        source_path = (payload.source_path or "").strip()[:MAX_SOURCE_PATH]
        row = await repo_growth.create_subscriber(
            session,
            email=email,
            source_path=source_path,
            source_channel=classify_channel(
                request.headers.get("referer", ""), host_of(settings.site_origin)
            ),
        )
    await session.commit()
    return {"ok": True, "status": row.status, "confirmUrl": confirm_url(settings, row.token)}


@router.get("/subscribe/confirm")
async def confirm_subscription(
    token: str = Query(default=""),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    row = await repo_growth.find_by_token(session, token)
    if row is None:
        return _invalid_link()

    if row.status == "confirmed":
        body = (
            "<p>这个地址已在名单中，不需要重复确认。若不再想收到，"
            f'<a href="/api/v1/unsubscribe?token={html.escape(row.token)}">点此退订</a>。</p>'
        )
    else:
        # Covers both the pending first confirmation and a reader who left and
        # changed their mind: the only way back in is following a link again.
        await repo_growth.set_status(session, row, "confirmed")
        await session.commit()
        body = (
            "<p>确认完成。我们只会在此后有成规模的更新时联系你，频率很低，"
            "每封信里都有退订链接。</p>"
        )
    return _page(title="订阅已确认", heading="订阅已确认", body=body)


@router.get("/unsubscribe")
async def unsubscribe(
    token: str = Query(default=""),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    row = await repo_growth.find_by_token(session, token)
    if row is None:
        return _invalid_link()

    if row.status != "unsubscribed":
        await repo_growth.set_status(session, row, "unsubscribed")
        await session.commit()
    return _page(
        title="已退订",
        heading="已退订",
        body="<p>这个地址不会再收到任何邮件。记录只保留为抑制名单，不会被重新加入。</p>",
    )


__all__ = ["confirm_url", "router"]
