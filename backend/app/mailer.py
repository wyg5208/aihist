"""The one outbound message this application sends.

Four constraints, all deliberate:

* **Transactional only.** An approved API key and nothing else. The subscriber
  list stays a list that the operator exports and mails with whatever tool they
  already use — that decision (see `api/growth.py`) has not changed just
  because one message now needs to leave.
* **Plain text.** A key in an HTML mail is a key in a screenshot; plain text is
  also the form that survives every client and spam filter.
* **Optional at runtime.** No `SMTP_HOST` means no mailer: the caller receives
  `(False, "smtp_not_configured")` and the console falls back to showing the
  plaintext once, for the operator to forward by hand. Approval must never
  depend on a mail server being reachable.
* **Never raises.** By the time a message is attempted the key already exists;
  a failed send is a fact to report alongside the key, not an exception that
  unwinds the approval.
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


def _send_sync(settings: Settings, to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from or settings.smtp_user
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    host = settings.smtp_host
    port = int(settings.smtp_port or 465)
    with_message = message

    if settings.smtp_starttls:
        with smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(with_message)
    else:
        with smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS) as smtp:
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(with_message)


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
    try:
        await asyncio.to_thread(_send_sync, settings, to, subject, body)
    except Exception as error:  # noqa: BLE001 - the key exists; report, do not raise
        logger.warning("could not mail a key to %s: %s", to, error)
        return False, "smtp_failed"
    return True, None


__all__ = ["configured", "send_api_key"]
