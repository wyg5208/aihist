"""Accounts and the read-only configuration report.

`/users` is the one place a second person is created, so it carries the two
guards that keep a single-operator project from locking itself out:

* an owner cannot demote or disable themselves through this endpoint. The env
  account remains the escape hatch, but relying on it after the fact is worse
  than refusing the click.
* the last *active* owner cannot be demoted. The rule is computed over the
  resulting table, not over the current one, so a role change and a
  deactivation cannot each look safe on their own and strand the console
  together.

`/settings` answers "is this deployment actually wired up" without exposing a
secret: every value is either a path, a boolean, or a count. It is the page that
turns "we never turned on the log ingest" from a mystery into a line of text.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, auth
from app.config import Settings, get_settings
from app.db import repo_admin, repo_ops
from app.deps import AdminPrincipal, client_ip, get_session, judge_env, require_permission
from app.editorial.panel import public_panel_info
from app.schemas.admin import admin_user_record

router = APIRouter()

MIN_PASSWORD = 12
_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,40}$")


def _entry(key: str, label: str, value: str, detail: str, level: str) -> dict[str, str]:
    return {"key": key, "label": label, "value": value, "detail": detail, "level": level}


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


class UserCreateRequest(BaseModel):
    model_config = {"populate_by_name": True}

    username: str = ""
    password: str = ""
    role: str = "analyst"


class UserPatchRequest(BaseModel):
    model_config = {"populate_by_name": True}

    role: str | None = None
    active: bool | None = None


class UserPasswordRequest(BaseModel):
    password: str = ""


def _check_role(role: str) -> str:
    if role not in auth.ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")
    return role


def _check_password(password: str) -> str:
    if len(password or "") < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail="password_too_short")
    return password


async def _load_user(session: AsyncSession, user_id: str):
    try:
        parsed = uuid.UUID(user_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="invalid_user_id") from None
    row = await repo_admin.find_user_by_id(session, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    return row


async def _strands_the_console(
    session: AsyncSession, target, *, role: str | None, active: bool | None
) -> bool:
    """Would the resulting table have no active owner left?"""
    owners = 0
    for row in await repo_admin.list_users(session):
        final_role = role if row.id == target.id and role is not None else row.role
        final_active = active if row.id == target.id and active is not None else row.active
        if final_role == "owner" and final_active:
            owners += 1
    return owners == 0


@router.get("/users")
async def list_users(
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    rows = await repo_admin.list_users(session)
    return {"ok": True, "items": [admin_user_record(row) for row in rows]}


@router.post("/users")
async def create_user(
    payload: UserCreateRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    username = (payload.username or "").strip()
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="invalid_username")
    _check_password(payload.password)
    role = _check_role(payload.role)
    if await repo_admin.find_user(session, username) is not None:
        raise HTTPException(status_code=409, detail="username_taken")

    row = await repo_admin.create_user(
        session, username=username, password_hash=auth.hash_password(payload.password), role=role
    )
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="user.create",
        target_type="admin_user",
        target_id=str(row.id),
        summary=f"created account {username} as {role}",
        detail={"username": username, "role": role},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True, "user": admin_user_record(row)}


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    payload: UserPatchRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await _load_user(session, user_id)
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nothing_to_update")
    role = _check_role(fields["role"]) if fields.get("role") is not None else None
    active = fields.get("active")

    if row.username == principal.username:
        # Cheap, and the alternative is a support request after a stray click.
        if role is not None and role != "owner":
            raise HTTPException(status_code=400, detail="cannot_demote_self")
        if active is False:
            raise HTTPException(status_code=400, detail="cannot_disable_self")

    if await _strands_the_console(session, row, role=role, active=active):
        raise HTTPException(status_code=400, detail="last_owner")

    await repo_admin.update_user(session, row, role=role, active=active)
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="user.update",
        target_type="admin_user",
        target_id=str(row.id),
        summary=f"updated account {row.username}",
        detail={"username": row.username, "role": row.role, "active": row.active},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True, "user": admin_user_record(row)}


@router.post("/users/{user_id}/password")
async def reset_password(
    user_id: str,
    payload: UserPasswordRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """An owner resets someone else's password. Your own goes through `/password`,
    which demands the old one; using this route for yourself would defeat that."""
    row = await _load_user(session, user_id)
    _check_password(payload.password)
    await repo_admin.set_password(session, row, auth.hash_password(payload.password))
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="user.password.reset",
        target_type="admin_user",
        target_id=str(row.id),
        summary=f"reset password for {row.username}",
        detail={"username": row.username, "self": row.username == principal.username},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Configuration report
# ---------------------------------------------------------------------------


@router.get("/settings")
async def settings_report(
    principal: AdminPrincipal = Depends(require_permission("manage")),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    bind = session.get_bind()
    dialect = bind.dialect.name if bind is not None else "unknown"
    panel = public_panel_info(judge_env(settings))
    users = await repo_admin.list_users(session)
    owners = [row for row in users if row.role == "owner" and row.active]
    keys = await repo_ops.key_usage(session)
    active_keys = [item for item in keys["items"] if item["active"]]

    if dialect == "sqlite":
        database_detail = "单文件 SQLite，写入串行化；埋点与采集同时写入时靠 busy_timeout 排队"
        database_level = "ok"
    else:
        database_detail = "PostgreSQL，可多实例部署"
        database_level = "ok"

    entries = [
        _entry("database", "数据库", dialect, database_detail, database_level),
        _entry(
            "session",
            "会话签名",
            f"{int(settings.session_max_age_seconds / 3600)} 小时",
            "SESSION_SECRET 已设置"
            if settings.session_secret
            else "SESSION_SECRET 为空，会话正在用一个开发用回退密钥签名",
            "ok" if settings.session_secret else "danger",
        ),
        _entry(
            "accounts",
            "后台账号",
            f"{len(users)} 个",
            f"其中 {len(owners)} 个启用中的 owner"
            + ("" if owners else "：没有任何 owner 能进后台，只能用环境变量账号救援"),
            "ok" if owners else "danger",
        ),
        _entry(
            "env_account",
            "环境变量账号",
            settings.admin_user if settings.admin_password_hash else "未配置",
            "始终可登录且视为 owner，是唯一不会被表里的误操作锁死的通道",
            "ok" if settings.admin_password_hash else "warn",
        ),
        _entry(
            "panel",
            "评审面板",
            f"{len(panel.get('models') or [])} 个模型" if panel.get("configured") else "未配置",
            "已配置：候选条目会过三角色评审闸门"
            if panel.get("configured")
            else f"未配置：候选全部暂缓入档（{panel.get('reason') or '缺少 judge 配置'}）",
            "ok" if panel.get("configured") else "danger",
        ),
        _entry(
            "analytics",
            "页面埋点",
            "开启" if settings.analytics_enabled else "关闭",
            "POST /api/v1/track 写入 page_views；关闭后仍然返回 204 且不落库"
            if settings.analytics_enabled
            else "已关闭：埋点端点仍然返回 204，但不写任何行",
            "ok" if settings.analytics_enabled else "warn",
        ),
        _entry(
            "access_log",
            "访问日志摄取",
            settings.analytics_log_path or "未接入",
            (
                f"格式 {settings.analytics_log_format}；每小时由 ingest-access-log 增量读取，"
                "AI 爬虫与静态引用页浏览只从这里得到"
            )
            if settings.analytics_log_path
            else "未配置 ANALYTICS_LOG_PATH：AI 抓取与 /e/<slug>.html 的浏览不可见",
            "ok" if settings.analytics_log_path else "warn",
        ),
        _entry(
            "open_api",
            "开放 API",
            "开启" if settings.open_api_enabled else "关闭",
            f"{len(active_keys)} 个生效密钥，本月合计 {sum(item['monthRequests'] for item in active_keys)} 次请求"
            if settings.open_api_enabled
            else "OPEN_API_ENABLED=false：/api/v1/open/* 返回 404",
            "ok" if settings.open_api_enabled else "warn",
        ),
        _entry(
            "retention",
            "分析数据保留",
            f"{settings.analytics_retention_days} 天",
            "prune 每周清理 page_views / crawl_hits / api_key_usage / audit_log",
            "ok",
        ),
        _entry(
            "mail",
            "邮件通道",
            "未配置",
            "本后台不发送邮件：订阅只做名单、同意留痕与 CSV 导出，发信在你自己的邮件工具里完成",
            "warn",
        ),
    ]
    return {"ok": True, "settings": entries}


__all__ = ["router"]
