"""The correction door: one page, one mailbox, no queue.

Every static citation page ends with a "发现错误？" link, and the reason the
archive claims to be checkable is that a reader who checks it has somewhere to
put the finding. A full ticket workflow would mean a new table, a migration and
a console queue before a single report has arrived; a prefilled `mailto` with
the entry, its sources and a three-line template costs a route and is honest
about what happens next.

Nothing is stored here. If reports start arriving faster than a mailbox can
carry them, this is the file to grow into a queue.
"""

from __future__ import annotations

import html
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import repo_events
from app.deps import get_session
from app.domain.slug import is_slug

router = APIRouter()

_TEMPLATE = """条目：{title}
日期：{date}
页面：{url}
问题：（哪一处不对：日期 / 事实 / 来源 / 影响判断）
依据：（一个能点开的链接）"""

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
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --page: #14120f; --ink: #e8e2d6; --dim: #9a938a; --rule: #2e2a24; --accent: #d4806a;
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
  h1 {{ margin: 0.9rem 0 0.5rem; font-size: 1.35rem; font-weight: 400; letter-spacing: 0.01em; }}
  h2 {{ margin: 1.6rem 0 0.5rem; font-size: 0.78rem; font-weight: 400; letter-spacing: 0.14em;
       text-transform: uppercase; color: var(--dim); }}
  p {{ margin: 0.6rem 0; font-size: 0.92rem; color: var(--dim); }}
  .meta {{ font: 0.72rem/1.6 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.08em; }}
  a {{ color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; }}
  .mail {{
    display: inline-block; margin: 0.6rem 0 0.2rem; padding: 0.5rem 1.2rem;
    border: 1px solid var(--ink); border-bottom: 1px solid var(--ink); border-radius: 3px;
    color: var(--page); background: var(--ink); font-size: 0.88rem;
  }}
  .mail:hover {{ background: var(--accent); border-color: var(--accent); color: #fff; }}
  ol.sources {{ margin: 0.3rem 0 0; padding-left: 1.2rem; }}
  ol.sources li {{ margin: 0.4rem 0; font-size: 0.86rem; color: var(--dim); overflow-wrap: anywhere; }}
  textarea {{
    width: 100%; min-height: 8.5rem; padding: 0.55rem 0.65rem; border: 1px solid var(--rule);
    border-radius: 3px; background: transparent; color: var(--ink); font: inherit; font-size: 0.82rem;
    resize: vertical;
  }}
  .rule {{ height: 1px; background: var(--rule); margin: 1.5rem 0; border: 0; }}
  .note {{ font-size: 0.8rem; color: var(--dim); }}
</style>
</head>
<body>
<main>
{body}
</main>
</body>
</html>
"""


def _page(*, title: str, body: str, status_code: int = 200) -> HTMLResponse:
    return HTMLResponse(
        content=_SHELL.format(title=html.escape(title), body=body),
        status_code=status_code,
        headers={
            "cache-control": "no-store",
            "x-robots-tag": "noindex, nofollow",
            "referrer-policy": "no-referrer",
        },
    )


def inbox(settings: Settings) -> str:
    """Explicit configuration wins; the fallback is derived, never invented."""
    explicit = (settings.contact_email or "").strip()
    if explicit:
        return explicit
    return f"correct@{urlsplit(settings.site_origin).hostname or 'aihist.net'}"


def _mailto(address: str, subject: str, body: str) -> str:
    return f"mailto:{address}?subject={quote(subject, safe='')}&body={quote(body, safe='')}"


def _general(settings: Settings) -> HTMLResponse:
    address = inbox(settings)
    skeleton = _TEMPLATE.format(
        title="（条目标题）", date="（日期）", url="（条目页面地址）"
    )
    href = _mailto(address, "纠错 · AI 纪年", skeleton)
    body = f"""  <p class="mark">AI 纪年 · 纠错</p>
  <h1>报告一条错误</h1>
  <p>这份档案的价值全在“能被核对”。如果你发现日期、事实、来源或判断有问题，直接写信就行——不用注册，也没有表单要填。</p>
  <h2>写信时请带三样</h2>
  <p>哪一条、哪里不对、你的依据。依据最好是一个能点开的链接：原始论文、官方公告、机构页面，都行。</p>
  <p><a class="mail" href="{href}">写信到 {html.escape(address)}</a></p>
  <hr class="rule">
  <p class="note">处理方式：能改的就改，改动记进审计日志；不该继续挂着的直接下架——下架后公开接口立刻返回 404，但原始记录不删。<a href="/">回到站点</a></p>
"""
    return _page(title="报告一条错误", body=body)


def _unknown(settings: Settings) -> HTMLResponse:
    address = inbox(settings)
    href = _mailto(address, "纠错 · 找不到条目", "页面：")
    body = f"""  <p class="mark">AI 纪年 · 纠错</p>
  <h1>这条不在公开档案里</h1>
  <p>链接可能不完整，也可能这条已经被下架。下架的条目对公开接口立即不可见，这是有意为之。</p>
  <p>如果你手上是一个仍然打不开的条目地址，把它发给我们，我们来查。</p>
  <p><a class="mail" href="{href}">写信到 {html.escape(address)}</a></p>
  <hr class="rule">
  <p class="note"><a href="/">回到站点</a></p>
"""
    return _page(title="找不到这条", body=body, status_code=404)


def _sources_html(sources: list) -> str:
    rows: list[str] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        url = str(source.get("url") or "")
        if not url.startswith(("http://", "https://")):
            continue
        label = str(source.get("title") or source.get("name") or url)
        host = urlsplit(url).hostname or ""
        rows.append(
            f'    <li><a href="{html.escape(url)}" target="_blank" rel="noopener noreferrer">'
            f"{html.escape(label)}</a> · {html.escape(host)}</li>"
        )
    if not rows:
        return "  <p>这条目前没有可点开的来源，本身就是个问题。</p>\n"
    return '  <ol class="sources">\n' + "\n".join(rows) + "\n  </ol>\n"


def _entry(settings: Settings, row) -> HTMLResponse:
    address = inbox(settings)
    slug = str(row.slug)
    url = f"{settings.site_origin.rstrip('/')}/e/{slug}.html"
    title = str(row.title)
    date = str(row.event_date)
    sources = row.sources if isinstance(row.sources, list) else []
    template = _TEMPLATE.format(title=title, date=date, url=url)
    href = _mailto(address, f"纠错 · {title}", template)
    listed = len([source for source in sources if isinstance(source, dict)])
    body = f"""  <p class="mark">AI 纪年 · 纠错</p>
  <h1>{html.escape(title)}</h1>
  <p class="meta">{html.escape(date)} · {html.escape(slug)}</p>
  <h2>这条现有的来源 · {listed}</h2>
{_sources_html(sources)}  <p>如果其中哪一条已经打不开，或者与原文对不上，请直接说。</p>
  <p><a class="mail" href="{href}">用邮件报告这条问题</a></p>
  <p class="note">邮件已预填条目、日期和链接，你只需要补上“哪里不对”和“依据”。</p>
  <hr class="rule">
  <h2>没有邮件客户端</h2>
  <p>把下面这段复制到任何一个能联系到我们的地方：</p>
  <textarea readonly rows="7">{html.escape(template)}</textarea>
  <p class="note"><a href="/?e={html.escape(slug)}">在时间轴中查看这条</a> · <a href="/">回到站点</a></p>
"""
    return _page(title=f"报告问题 · {title}", body=body)


@router.get("/correct", include_in_schema=False)
async def correct(
    slug: str = Query(default=""),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    handle = (slug or "").strip()
    if not handle:
        return _general(settings)
    if not is_slug(handle):
        return _unknown(settings)

    row = await repo_events.read_event_by_slug(session, handle)
    if row is None or row.editorial_status in ("excluded", "hold"):
        return _unknown(settings)
    return _entry(settings, row)


__all__ = ["inbox", "router"]
