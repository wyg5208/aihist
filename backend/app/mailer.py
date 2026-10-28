"""Outbound mail. Two messages, and nothing else.

* **The approved API key** (`send_api_key`). Transactional: it exists because a
  key is only ever shown once, and the person who applied for it is not the
  person reading the console.
* **The weekly digest** (`send_batch`). Editorial: `app/digest.py` composes it,
  this module only carries it to one address at a time.

Four constraints apply to both, all deliberate:

* **Plain text.** A key in an HTML mail is a key in a screenshot; a plain body
  also survives every client and spam filter. The digest needs dates, one line
  of why each entry matters and a source link, none of which need a stylesheet.
* **Optional at runtime.** No `SMTP_HOST` means no mailer: callers receive
  `(False, "smtp_not_configured")`. The console then shows a key's plaintext
  once for manual forwarding, and `weekly-digest` prints a skip line instead of
  claiming it mailed anyone.
* **Never raises.** By the time a message is attempted, the key already exists
  or the delivery row is already reserved; a failed send is a fact to report
  next to what it was about, not an exception that unwinds a commit or a
  scheduled job.
* **One connection per run.** Per-message connections are a TLS handshake and
  a login each, which providers throttle; `send_batch` opens one session and
  walks the list inside it.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.config import Settings

logger = logging.getLogger("aihist.mailer")

TIMEOUT_SECONDS = 15


def configured(settings: Settings) -> bool:
    """A host and a from-address are the whole requirement; user is optional."""
    return bool(settings.smtp_host and (settings.smtp_from or settings.smtp_user))


def _body(*, name: str, plaintext: str, monthly_quota: int, site_origin: str) -> str:
    quota = f"{monthly_quota} 次/月（自然月重置）" if monthly_quota > 0 else "不限额"
    origin = site_origin.rstrip("/")
    return (
        f"你在 AI 纪年提交的开放数据 API 申请已通过。\n\n"
        f"申请名称：{name}\n"
        f"密钥：{plaintext}\n"
        f"配额：{quota}\n\n"
        f"调用示例：\n"
        f'  curl -H "X-API-Key: {plaintext}" {origin}/api/v1/open/events\n\n'
        f"端点：\n"
        f"  GET /api/v1/open/events?since=YYYY-MM-DD&limit=100   按更新时间增量拉取\n"
        f"  GET /api/v1/open/events/{{slug}}                      单条详情，含来源链接\n\n"
        f"几条规则：\n"
        f"  - 条目与公开时间轴一致；暂缓与已下架的条目不对外提供。\n"
        f"  - 引用时请保留条目链接与来源地址；不要整段搬运来源原文。\n"
        f"  - 配额按自然月计数，超限返回 429；滥用会直接吊销密钥。\n\n"
        f"服务端只保存密钥的 sha256 摘要，我们无法再次取回这串明文。\n"
        f"如果丢失，请在申请页重新提交一次。\n\n"
        f"-- AI 纪年 · {origin}\n"
    )


def _open(settings: Settings):
    """Authenticated session. Port decides the shape: 465 implicit TLS, 587 STARTTLS.

    The caller owns the session and is responsible for closing it; a login that
    fails is closed here so a half-open socket cannot outlive the call.
    """
    host = settings.smtp_host
    port = int(settings.smtp_port or 465)

    if settings.smtp_starttls:
        smtp = smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS)
        try:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
        except Exception:
            smtp.close()
            raise
        return smtp

    smtp = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS)
    try:
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
    except Exception:
        smtp.close()
        raise
    return smtp


def _message(settings: Settings, to: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = settings.smtp_from or settings.smtp_user
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    return message


def _send_all_sync(
    settings: Settings, messages: list[tuple[str, str, str]]
) -> list[tuple[bool, str | None]]:
    """One connection, one answer per message, in order.

    A failure inside the loop is recorded and the loop continues; the address
    that bounced must not cost the next one its mail. If the *connection* is
    what failed, every remaining message is reported as failed rather than
    retried here — the delivery ledger keeps them for the next run.
    """
    results: list[tuple[bool, str | None]] = []
    try:
        smtp = _open(settings)
    except Exception as error:  # noqa: BLE001 - reported per message, never raised
        logger.warning("could not open smtp session on %s: %s", settings.smtp_host, error)
        return [(False, "smtp_failed") for _ in messages]

    with smtp:
        for to, subject, body in messages:
            try:
                smtp.send_message(_message(settings, to, subject, body))
            except Exception as error:  # noqa: BLE001 - one address, not the run
                logger.warning("could not mail %s: %s", to, error)
                results.append((False, "smtp_failed"))
            else:
                results.append((True, None))
    return results


async def send_batch(
    settings: Settings, messages: list[tuple[str, str, str]]
) -> list[tuple[bool, str | None]]:
    """`[(to, subject, body), ...]` in, `[(sent, error), ...]` out, same order."""
    if not messages:
        return []
    if not configured(settings):
        return [(False, "smtp_not_configured") for _ in messages]
    return await asyncio.to_thread(_send_all_sync, settings, list(messages))


async def send_api_key(
    settings: Settings,
    *,
    to: str,
    name: str,
    plaintext: str,
    monthly_quota: int,
) -> tuple[bool, str | None]:
    """`(sent, error)`. The plaintext is only ever placed in the body."""
    if not configured(settings):
        return False, "smtp_not_configured"
    body = _body(
        name=name,
        plaintext=plaintext,
        monthly_quota=monthly_quota,
        site_origin=settings.site_origin,
    )
    subject = "[AI 纪年] 开放数据 API 密钥"
    results = await send_batch(settings, [(to, subject, body)])
    return results[0]


__all__ = ["configured", "send_api_key", "send_batch"]
