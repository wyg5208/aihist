"""Public subscribe, confirm and unsubscribe.

Double opt-in without a mailer.

The console does not send email — see Settings, which says so plainly — so the
confirmation link is returned in the subscribe response and shown to the reader
in the browser. In a deployment that does have an outbound mail tool, the
operator takes the exported list and sends `confirmUrl` themselves. That keeps
deliverability, bounces and complaints outside this application while still
producing a consent record that means something: `status='confirmed'` only ever
comes from someone following the link.

The weekly digest (`app/digest.py`) is the one message that does leave this box.
That is the whole reason `confirmed` is not a flag: it addresses only rows that
got here through the link below, and every message carries the `/unsubscribe`
link this module defines.

Nothing here is authenticated and nothing here reveals whether an address is
already on the list beyond the status of the address the caller just typed.
"""

from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import ip_digest
from app.analytics.channels import classify_channel, host_of
from app.analytics.throttle import SlidingWindow
from app.config import Settings, get_settings
from app.db import repo_growth
from app.deps import client_ip, get_session

router = APIRouter()

MAX_SOURCE_PATH = 200
FORM_MAX_SRC_CHARS = 40
FORM_RATE_LIMIT = 5
FORM_RATE_WINDOW_SECONDS = 3600.0

# The form is the only unauthenticated write here, so it gets the same guard as
# the API application form — from the same class, so the two cannot drift.
_form_window = SlidingWindow(FORM_RATE_LIMIT, FORM_RATE_WINDOW_SECONDS)

_SRC_RE = re.compile(r"[^a-z0-9_-]+")


def reset_form_throttle() -> None:
    """Testing seam."""
    _form_window.reset()


def clean_src(value: str) -> str:
    """A campaign tag, not a URL: lower-case, digits, dash and underscore."""
    return _SRC_RE.sub("", (value or "").strip().lower())[:FORM_MAX_SRC_CHARS]


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
{extra_css}
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
    *, title: str, heading: str, body: str, status_code: int = 200, extra_css: str = ""
) -> HTMLResponse:
    document = _PAGE.format(
        title=html.escape(title),
        heading=html.escape(heading),
        body=body,
        extra_css=extra_css,
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


# The form needs the few rules the result pages never use; `_page` takes them as
# a slot so both kinds of page keep sharing one shell.
_FORM_CSS = """  form { margin-top: 1.3rem; display: grid; gap: 0.85rem; }
  label { display: grid; gap: 0.3rem; font-size: 0.82rem; color: var(--dim); }
  input[type="email"] {
    width: 100%; padding: 0.5rem 0.6rem; border: 1px solid var(--rule); border-radius: 3px;
    background: var(--page); color: var(--ink); font: inherit; font-size: 0.9rem;
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .check { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.8rem; }
  .check input { margin-top: 0.35rem; }
  .hp { position: absolute; left: -9999px; top: 0; height: 1px; overflow: hidden; }
  button {
    justify-self: start; padding: 0.5rem 1.4rem; border: 1px solid var(--ink); border-radius: 3px;
    background: var(--ink); color: var(--page); font: inherit; font-size: 0.88rem; cursor: pointer;
  }
  button:hover { background: var(--accent); border-color: var(--accent); }"""

_FORM_BODY = """  <p class="mark">AI 纪年 · 简报名单</p>
  <h1>订阅《AI 纪年》</h1>
  <p>每周一发一封：日期、一句为什么重要、来源链接；这一周没有新增就不发。每封都带退订。</p>
  <form method="post" action="/api/v1/subscribe/form">
{src_field}    <label>邮箱
      <input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com">
    </label>
    <label class="hp" aria-hidden="true">website
      <input type="text" name="website" tabindex="-1" autocomplete="off">
    </label>
    <label class="check">
      <input type="checkbox" name="consent" required>
      <span>我同意用这个地址接收更新，随时可退订</span>
    </label>
    <button type="submit">订阅</button>
  </form>
  <hr class="rule">
  <p class="note">地址只用于发信与退订，不进任何第三方统计。本站不发确认邮件，确认链接在提交后直接显示。<a href="/">回到站点</a></p>
"""


async def _form_fields(request: Request) -> dict[str, str]:
    """`application/x-www-form-urlencoded` without a parser dependency."""
    raw = await request.body()
    parsed = parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True)
    return {key: (values[0] if values else "") for key, values in parsed.items()}


def _signup_page(src: str) -> HTMLResponse:
    hidden = f'    <input type="hidden" name="src" value="{html.escape(src)}">\n' if src else ""
    return _page(
        title="订阅《AI 纪年》",
        heading="订阅《AI 纪年》",
        body=_FORM_BODY.format(src_field=hidden),
        extra_css=_FORM_CSS,
    )


def _signup_result(*, title: str, heading: str, body: str, status_code: int = 200) -> HTMLResponse:
    return _page(title=title, heading=heading, body=body, status_code=status_code)


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


@router.get("/subscribe", include_in_schema=False)
async def subscribe_form(src: str = Query(default="")) -> HTMLResponse:
    """The reader-facing form. The footer links here; `/subscribe` also answers POST
    as JSON, which is a different tool for a different caller."""
    return _signup_page(clean_src(src))


@router.post("/subscribe/form", include_in_schema=False)
async def submit_subscription_form(
    request: Request,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    ip = client_ip(request)
    if not _form_window.allow(ip_digest(ip, settings) or "anonymous"):
        return _signup_result(
            title="提交过于频繁",
            heading="提交过于频繁",
            body=f"<p>同一网络一小时最多提交 {FORM_RATE_LIMIT} 次。如果刚才已提交成功，确认链接就在那一页上。</p>",
            status_code=429,
        )

    fields = await _form_fields(request)
    if (fields.get("website") or "").strip():
        # Honeypot: a browser user never sees this field.
        return _signup_result(
            title="已收到",
            heading="已收到",
            body="<p>若这是你本人提交的，请回到站点重新填写一次。</p>",
        )

    if (fields.get("consent") or "").strip().lower() not in ("on", "true", "1", "yes"):
        return _signup_result(
            title="需要同意",
            heading="请先勾选同意",
            body="<p>地址只用于发信与退订。勾选后才能提交，这也是我们保留同意记录的凭据。</p>",
            status_code=400,
        )

    email = (fields.get("email") or "").strip()
    if not repo_growth.looks_like_email(email):
        return _signup_result(
            title="邮箱格式不对",
            heading="邮箱格式不对",
            body="<p>请填一个能长期使用的地址，否则收不到更新也退不了订。</p>",
            status_code=400,
        )

    src = clean_src(fields.get("src") or "")
    source_path = f"/subscribe?src={src}" if src else "/subscribe"
    normalised = repo_growth.normalize_email(email)
    row = await repo_growth.find_by_email(session, normalised)
    if row is None:
        row = await repo_growth.create_subscriber(
            session,
            email=normalised,
            source_path=source_path[:MAX_SOURCE_PATH],
            source_channel=classify_channel(
                request.headers.get("referer", ""), host_of(settings.site_origin)
            ),
        )
    await session.commit()

    return _signup_result(
        title="已记录",
        heading="还差一步",
        body=(
            "<p>点开下面的确认链接，订阅才算生效：只有跟过这个链接的地址，"
            "才会被算作同意。</p>"
            f'<p><a href="{html.escape(confirm_url(settings, row.token))}">{html.escape(normalised)} 确认订阅</a></p>'
            '<p class="note">本站不发确认邮件，这个链接只在本页出现一次；'
            '想保存的话现在就把页面收藏起来。每封信里都有退订链接。</p>'
        ),
    )


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
            "<p>确认完成。此后每周一给你发一封，只写这一周新增了什么；"
            "这一周没有新增就不发。每封都带退订链接。</p>"
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


__all__ = ["clean_src", "confirm_url", "reset_form_throttle", "router"]
