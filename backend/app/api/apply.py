"""Public application form for an open-data key.

Why HTML instead of JSON: the person filling this in is a browser, and the page
has to work with no build step — the process that stores the row is also the
process that serves the form. `growth.py` (unsubscribe links) already
establishes the pattern: inline CSS, no scripts, noindex.

The queue is deliberately human. Approval is where a person decides what a key
is worth, so there is no auto-issue endpoint to script against; a submitted
form only ever creates a `pending` row.

Two cheap anti-abuse measures, both visible below: a per-address sliding
window, and a honeypot field no browser user can see. A bot that fills it gets
the success page and no row — telling it the difference would just teach it
what to avoid.

The form is closed while `OPEN_API_ENABLED` is false, for the same reason the
read API is: a programme that has not launched should not collect applications
it cannot honour.
"""

from __future__ import annotations

import html
from typing import Any
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import ip_digest
from app.analytics.throttle import SlidingWindow
from app.config import Settings, get_settings
from app.db import repo_commercial, repo_growth
from app.deps import client_ip, get_session

router = APIRouter()

RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 3600.0
MIN_PURPOSE_CHARS = 10

# Same window the subscribe form uses; one implementation, two callers.
_window = SlidingWindow(RATE_LIMIT, RATE_WINDOW_SECONDS)


def reset_rate_limit() -> None:
    """Testing seam."""
    _window.reset()


def allow(key: str, *, moment: float | None = None) -> bool:
    return _window.allow(key, moment=moment)


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

_SHELL = """<!doctype html>
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
    --field: #fffdf8;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --page: #14120f; --ink: #e8e2d6; --dim: #9a938a; --rule: #2e2a24; --accent: #d4806a;
      --field: #1b1814;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100dvh; display: flex; align-items: flex-start; justify-content: center;
    padding: 3rem 1.25rem 4rem; background: var(--page); color: var(--ink);
    font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif; line-height: 1.75;
  }}
  main {{ width: 100%; max-width: 33rem; }}
  .mark {{
    font: 0.68rem/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--dim);
  }}
  h1 {{ margin: 0.9rem 0 0.5rem; font-size: 1.5rem; font-weight: 400; letter-spacing: 0.01em; }}
  h2 {{ margin: 1.6rem 0 0.5rem; font-size: 0.82rem; font-weight: 400; letter-spacing: 0.14em;
       text-transform: uppercase; color: var(--dim); }}
  p {{ margin: 0.6rem 0; font-size: 0.92rem; color: var(--dim); }}
  .lede {{ font-size: 0.95rem; color: var(--ink); }}
  form {{ margin-top: 1.4rem; display: grid; gap: 0.9rem; }}
  label {{ display: grid; gap: 0.3rem; font-size: 0.82rem; color: var(--dim); }}
  input[type="text"], input[type="email"], input[type="url"], textarea {{
    width: 100%; padding: 0.5rem 0.6rem; border: 1px solid var(--rule); border-radius: 3px;
    background: var(--field); color: var(--ink); font: inherit; font-size: 0.9rem;
  }}
  input:focus-visible, textarea:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 1px; }}
  textarea {{ resize: vertical; min-height: 6rem; }}
  .check {{ display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.82rem; }}
  .check input {{ margin-top: 0.35rem; }}
  .hp {{ position: absolute; left: -9999px; top: 0; height: 1px; overflow: hidden; }}
  button {{
    justify-self: start; padding: 0.5rem 1.4rem; border: 1px solid var(--ink); border-radius: 3px;
    background: var(--ink); color: var(--page); font: inherit; font-size: 0.88rem; cursor: pointer;
  }}
  button:hover {{ background: var(--accent); border-color: var(--accent); }}
  .terms ul {{ margin: 0.4rem 0 0; padding-left: 1.1rem; }}
  .terms li {{ margin: 0.3rem 0; font-size: 0.85rem; color: var(--dim); }}
  .rule {{ height: 1px; background: var(--rule); margin: 1.6rem 0; border: 0; }}
  .note {{ font-size: 0.8rem; color: var(--dim); }}
  a {{ color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; }}
</style>
</head>
<body>
<main>
{body}
</main>
</body>
</html>
"""

_FORM_BODY = """  <p class="mark">AI 纪年 · 开放数据 API</p>
  <h1>申请 API 密钥</h1>
  <p class="lede">接口面向在自己产品里嵌入 AI 大事记、或需要结构化历史数据的调用方。条目与公开时间轴一致，每条都带来源地址。</p>
  <form method="post" action="/api/v1/open/apply">
    <label>邮箱
      <input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com">
    </label>
    <label>名称
      <input type="text" name="name" required maxlength="80" placeholder="个人或产品名">
    </label>
    <label>用途
      <textarea name="purpose" required maxlength="1000" rows="4"
        placeholder="打算怎么用：产品形态、展示位置、大致调用量。这段文字是审核的主要依据。"></textarea>
    </label>
    <label>网址（可选）
      <input type="url" name="siteUrl" maxlength="300" placeholder="https://">
    </label>
    <label class="hp" aria-hidden="true">website
      <input type="text" name="website" tabindex="-1" autocomplete="off">
    </label>
    <label class="check">
      <input type="checkbox" name="consent" required>
      <span>我同意按下方条款使用这些数据</span>
    </label>
    <button type="submit">提交申请</button>
  </form>
  <section class="terms">
    <h2>条款要点</h2>
    <ul>
      <li>配额默认每月 1000 次，按自然月重置；超限返回 429，被拒绝的请求同样计数。</li>
      <li>只提供公开时间轴上的条目：暂缓与已下架的内容对密钥同样不可见。</li>
      <li>引用时保留条目链接与来源地址；不要整段搬运来源原文。</li>
      <li>不承诺可用性与响应时间；滥用会直接吊销密钥。</li>
      <li>密钥只存 sha256 摘要，服务端无法取回明文；丢失请重新提交申请。</li>
    </ul>
  </section>
  <hr class="rule">
  <p class="note">人工审核，通常在一两个工作日内处理。审批结果会发送到填写的邮箱。<a href="/">回到站点</a></p>
"""

_FORM_ACTION = '<a href="/api/v1/open/apply">返回申请表</a>'


def _page(*, title: str, body: str, status_code: int = 200) -> HTMLResponse:
    document = _SHELL.format(title=html.escape(title), body=body)
    return HTMLResponse(
        content=document,
        status_code=status_code,
        headers={
            "cache-control": "no-store",
            "x-robots-tag": "noindex, nofollow",
            "referrer-policy": "no-referrer",
        },
    )


def _result(*, title: str, heading: str, paragraphs: list[str], status_code: int = 200) -> HTMLResponse:
    body = (
        '  <p class="mark">AI 纪年 · 开放数据 API</p>\n'
        f"  <h1>{html.escape(heading)}</h1>\n"
        + "".join(f"  <p>{text}</p>\n" for text in paragraphs)
        + f'  <hr class="rule">\n  <p class="note">{_FORM_ACTION} · <a href="/">回到站点</a></p>\n'
    )
    return _page(title=title, body=body, status_code=status_code)


def _closed() -> HTMLResponse:
    """The switch is off, but the page still has to be a way out.

    The footer link that lands here is always visible — it does not follow this
    switch — so a reader who taps it deserves an answer better than "nothing
    here": when the form opens, and what is readable meanwhile. Status stays 404
    because the channel genuinely does not exist yet; the body is what a person
    sees, and a 404 with a route home is still a route home.
    """
    body = (
        '  <p class="mark">AI 纪年 · 开放数据 API</p>\n'
        '  <h1>开放数据接口尚未开放</h1>\n'
        '  <p class="lede">读取接口与这张申请表会同时启用。当前阶段只开放阅读，不接收申请。</p>\n'
        '  <p>档案本身随时可读：每条都带来源地址，可逐条核对。'
        "开放后这里会先通知订阅者，再对外放号。</p>\n"
        '  <hr class="rule">\n'
        '  <p class="note"><a href="/api/v1/subscribe?src=apply">订阅开放通知</a> · '
        '<a href="/">先看时间轴</a></p>\n'
    )
    return _page(title="通道未开放", body=body, status_code=404)


def _consent_required() -> HTMLResponse:
    return _result(
        title="需要同意条款",
        heading="请先勾选同意条款",
        paragraphs=["数据可以免费使用，前提是保留来源与链接。请回到表单勾选该选项再提交。"],
        status_code=400,
    )


def _invalid_email() -> HTMLResponse:
    return _result(
        title="邮箱格式不对",
        heading="邮箱格式不对",
        paragraphs=["收不到审批结果就找不到密钥，请填一个能长期使用的邮箱。"],
        status_code=400,
    )


def _invalid_details() -> HTMLResponse:
    return _result(
        title="信息不完整",
        heading="信息不完整",
        paragraphs=[f"名称和用途都要填，用途至少 {MIN_PURPOSE_CHARS} 个字——审核只看这两行。"],
        status_code=400,
    )


def _submitted(email: str) -> HTMLResponse:
    return _result(
        title="已收到申请",
        heading="已收到申请",
        paragraphs=[
            f"审批结果会发送到 {html.escape(email)}。",
            "通过后密钥只出现一次：服务端只保存摘要，我们无法再次取回明文。",
        ],
    )


def _already_queued(email: str) -> HTMLResponse:
    return _result(
        title="申请已在队列中",
        heading="这个邮箱已在队列中",
        paragraphs=[
            f"{html.escape(email)} 已有一条待审申请，不必重复提交。",
            "如果想补充说明，可以换一个更完整的用途描述后重新提交，我们会以最新一条为准。",
        ],
    )


def _throttled() -> HTMLResponse:
    return _result(
        title="提交过于频繁",
        heading="提交过于频繁",
        paragraphs=[f"同一网络一小时最多提交 {RATE_LIMIT} 次。若刚才已经提交成功，请等待审批结果。"],
        status_code=429,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


async def _fields(request: Request) -> dict[str, str]:
    """`application/x-www-form-urlencoded` without pulling in a parser dependency."""
    raw = await request.body()
    text = raw.decode("utf-8", "replace")
    parsed = parse_qs(text, keep_blank_values=True)
    return {key: (values[0] if values else "") for key, values in parsed.items()}


def _gate(settings: Settings) -> HTMLResponse | None:
    return None if settings.open_api_enabled else _closed()


@router.get("/apply", include_in_schema=False)
async def apply_form(settings: Settings = Depends(get_settings)) -> HTMLResponse:
    closed = _gate(settings)
    if closed is not None:
        return closed
    return _page(title="申请 API 密钥", body=_FORM_BODY)


@router.post("/apply", include_in_schema=False)
async def submit_application(
    request: Request,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    closed = _gate(settings)
    if closed is not None:
        return closed

    ip = client_ip(request)
    if not allow(ip_digest(ip, settings) or "anonymous"):
        return _throttled()

    fields = await _fields(request)
    if (fields.get("website") or "").strip():
        # Honeypot: a browser user never sees this field.
        return _submitted(fields.get("email") or "该邮箱")

    if (fields.get("consent") or "").strip().lower() not in ("on", "true", "1", "yes"):
        return _consent_required()

    email = (fields.get("email") or "").strip()
    if not repo_growth.looks_like_email(email):
        return _invalid_email()

    name = (fields.get("name") or "").strip()
    purpose = (fields.get("purpose") or "").strip()
    if not name or len(purpose) < MIN_PURPOSE_CHARS:
        return _invalid_details()

    existing = await repo_commercial.find_pending_application(session, email)
    if existing is not None:
        return _already_queued(email)

    site_url: Any = (fields.get("siteUrl") or "").strip()
    if site_url and not repo_commercial.normalize_target(site_url):
        site_url = ""

    await repo_commercial.create_application(
        session,
        email=email,
        name=name,
        purpose=purpose,
        site_url=site_url,
    )
    await session.commit()
    return _submitted(repo_growth.normalize_email(email))


__all__ = ["allow", "reset_rate_limit", "router"]
