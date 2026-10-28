"""Source catalogue management: add, edit, enable, probe — without a redeploy.

Two rules shape this module:

* **Nothing is enabled before it is probed.** A dead feed in the catalogue is
  worse than a missing one, because the health matrix will keep reporting a
  failure nobody owns. `enabled` requires a non-empty `verified_at`.
* **A probe is an outbound request an admin typed.** That makes it the one place
  in the console where user input reaches the network, so the URL is validated
  twice: shape first (scheme, userinfo, port, length), then every resolved
  address must be public. It is also bounded like any other fetch.

The probe never writes. `POST /sources/registry/**` is where a row appears, so an
operator can paste a candidate, read the sample, and only then decide.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
import time
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import Settings, get_settings
from app.db import repo_ops
from app.db.models import IngestSource, utc_now
from app.deps import AdminPrincipal, client_ip, get_session, require_permission
from app.ingest import catalog, registry
from app.ingest.sources import (
    FetchResult,
    SOURCE_TIMEOUT_MS,
    httpx_fetch,
    load_source,
)

router = APIRouter()

PROBE_TIMEOUT_MS = 15_000
ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({80, 443, 8080, 8443})
MAX_URL_LENGTH = 2048
_PROBE_ITEM_LIMIT = 5

Fetcher = Callable[[str], Awaitable[FetchResult]]


async def _default_probe_fetch(url: str) -> FetchResult:
    return await httpx_fetch(url, timeout_ms=PROBE_TIMEOUT_MS)


# ---------------------------------------------------------------------------
# SSRF guard
# ---------------------------------------------------------------------------


def _check_url_shape(url: str) -> str:
    """Reject what can be rejected without touching DNS. Returns the hostname."""
    if not url or len(url) > MAX_URL_LENGTH:
        raise HTTPException(status_code=400, detail="invalid_url")
    parts = urlsplit(url)
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise HTTPException(status_code=400, detail="invalid_scheme")
    if parts.username or parts.password or "@" in parts.netloc:
        raise HTTPException(status_code=400, detail="userinfo_not_allowed")
    host = (parts.hostname or "").strip().lower()
    if not host:
        raise HTTPException(status_code=400, detail="invalid_url")
    try:
        port = parts.port
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_url") from None
    if port is not None and port not in ALLOWED_PORTS:
        raise HTTPException(status_code=400, detail="port_not_allowed")
    return host


def _address_forbidden(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return True
    return not parsed.is_global or parsed.is_multicast


async def _resolve(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return [str(info[4][0]) for info in infos]


async def validate_source_url(url: str) -> str:
    """Shape check plus a resolved-address check. Returns the hostname.

    A resolver failure is *not* a rejection: the probe that follows is the real
    gate, and it cannot connect to a name that does not resolve either. Every
    address that does resolve must be public, which is what stops the obvious
    `http://169.254.169.254/` style attempt.
    """
    host = _check_url_shape(url)
    try:
        addresses = await _resolve(host)
    except (socket.gaierror, OSError):
        return host
    for address in addresses:
        if _address_forbidden(address):
            raise HTTPException(status_code=400, detail="private_address")
    return host


# ---------------------------------------------------------------------------
# Probe
# ---------------------------------------------------------------------------


def _probe_source(payload: "ProbeRequest") -> dict[str, Any]:
    return {
        "key": payload.key or "probe",
        "family": payload.family or "official",
        "name": payload.name or payload.key or "probe",
        "kind": payload.kind,
        "url": payload.url,
        "pathPattern": payload.pathPattern or "/news/",
        "timeout": payload.timeoutMs,
    }


def _status_of(error: str | None) -> int | None:
    match = re.fullmatch(r"http_(\d{3})", error or "")
    return int(match.group(1)) if match else None


def _sample(items: list[dict[str, Any]]) -> dict[str, Any]:
    sample = [
        {
            "title": str(item.get("title") or "")[:200],
            "url": item.get("url") or "",
            "publishedAt": item.get("publishedAt"),
        }
        for item in items[:_PROBE_ITEM_LIMIT]
    ]
    dates = [str(item["publishedAt"]) for item in items if item.get("publishedAt")]
    return {
        "sample": sample,
        "latestAt": max(dates) if dates else None,
        "itemCount": len(items),
    }


async def _run_probe(payload: "ProbeRequest", *, fetch: Fetcher | None = None) -> dict[str, Any]:
    """Fetch once with the real parser. Never raises on upstream failure."""
    source = _probe_source(payload)
    started = int(time.time() * 1000)
    result = await load_source(
        source,
        fetch=fetch or _default_probe_fetch,
        deadline_ms=started + max(1_000, payload.timeoutMs),
        allowed={urlsplit(source["url"]).hostname or ""},
    )
    body = {
        "ok": bool(result.get("ok")),
        "status": _status_of(result.get("error")),
        "ms": int(result.get("ms") or 0),
        "attempts": int(result.get("attempts") or 0),
        "error": result.get("error"),
        "sample": [],
        "latestAt": None,
        "itemCount": 0,
        "url": source["url"],
        "kind": source["kind"],
    }
    if result.get("ok"):
        body.update(_sample(list(result.get("items") or [])))
    return body


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class ProbeRequest(BaseModel):
    url: str
    kind: str = Field(default="feed")
    key: str | None = None
    name: str | None = None
    family: str | None = None
    pathPattern: str | None = None
    timeoutMs: int = Field(default=SOURCE_TIMEOUT_MS, ge=1_000, le=30_000)


class SourceRequest(BaseModel):
    key: str
    name: str = ""
    family: str = "official"
    kind: str = "feed"
    url: str
    pathPattern: str = "/news/"
    domestic: bool = False
    aiOnly: bool = False
    timeoutMs: int = Field(default=SOURCE_TIMEOUT_MS, ge=1_000, le=30_000)
    rationale: str = ""
    enabled: bool = False


class SourcePatch(BaseModel):
    name: str | None = None
    family: str | None = None
    kind: str | None = None
    url: str | None = None
    pathPattern: str | None = None
    domestic: bool | None = None
    aiOnly: bool | None = None
    timeoutMs: int | None = Field(default=None, ge=1_000, le=30_000)
    rationale: str | None = None


class EnabledRequest(BaseModel):
    enabled: bool


def _check_enums(*, family: str | None = None, kind: str | None = None) -> None:
    if family is not None and family not in catalog.FAMILIES:
        raise HTTPException(status_code=400, detail="invalid_family")
    if kind is not None and kind not in catalog.KINDS:
        raise HTTPException(status_code=400, detail="invalid_kind")


def _record(row: IngestSource) -> dict[str, Any]:
    from app.ingest.registry import source_dict

    payload = source_dict(row)
    payload["familyLabel"] = catalog.FAMILY_LABELS.get(payload["family"], payload["family"])
    payload["verifiedAt"] = payload["verifiedAt"].isoformat() if payload["verifiedAt"] else None
    payload["createdAt"] = row.created_at.isoformat() if row.created_at else None
    payload["updatedAt"] = row.updated_at.isoformat() if row.updated_at else None
    return payload


async def _load(session: AsyncSession, key: str) -> IngestSource:
    row = await session.get(IngestSource, key)
    if row is None:
        raise HTTPException(status_code=404, detail="source_not_found")
    return row


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/sources/registry")
async def list_registry(
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Catalogue ⨝ health. Disabled sources are included on purpose: the point of
    the page is to answer "what could we be collecting", not only "what ran"."""
    try:
        # The catalogue is materialised on first visit, so the page can show the
        # candidates a fresh install has never collected. Idempotent: once a row
        # exists this is a single count.
        await registry.ensure_catalog(session)
    except Exception:  # noqa: BLE001 - a missing table degrades to the frozen seed
        pass
    items = await repo_ops.source_health(session)
    families: dict[str, int] = {}
    for item in items:
        families[item.get("family") or ""] = families.get(item.get("family") or "", 0) + 1
    return {
        "ok": True,
        "items": items,
        "total": len(items),
        "enabled": sum(1 for item in items if item.get("enabled")),
        "unverified": sum(1 for item in items if not item.get("verifiedAt")),
        "families": [
            {
                "key": key,
                "label": catalog.FAMILY_LABELS.get(key, key),
                "count": count,
            }
            for key, count in sorted(families.items())
            if key
        ],
        "kinds": sorted(catalog.KINDS),
    }


@router.post("/sources/probe")
async def probe_source(
    payload: ProbeRequest,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
) -> dict[str, Any]:
    """Dry run against an arbitrary candidate URL. Writes nothing."""
    _check_enums(kind=payload.kind, family=payload.family)
    await validate_source_url(payload.url)
    return {"ok": True, "probe": await _run_probe(payload)}


@router.post("/sources/registry")
async def create_source(
    payload: SourceRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        key = catalog.validate_key(payload.key)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    _check_enums(family=payload.family, kind=payload.kind)
    await validate_source_url(payload.url)
    if await session.get(IngestSource, key) is not None:
        raise HTTPException(status_code=409, detail="key_exists")
    if payload.enabled:
        # Enabling here would bypass the probe gate; the caller has to probe
        # first and then flip the switch on the row that exists.
        raise HTTPException(status_code=409, detail="probe_required")

    moment = utc_now()
    row = IngestSource(
        key=key,
        name=payload.name.strip() or key,
        family=payload.family,
        kind=payload.kind,
        url=payload.url,
        path_pattern=payload.pathPattern or "/news/",
        domestic=payload.domestic,
        ai_only=payload.aiOnly,
        enabled=False,
        weight=100,
        timeout_ms=payload.timeoutMs,
        rationale=payload.rationale[:2000],
        verified_at=None,
        created_by=principal.username,
        created_at=moment,
        updated_at=moment,
    )
    session.add(row)
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="source.create",
        target_type="source",
        target_id=key,
        summary=f"create {payload.family}/{payload.kind} {payload.url}",
        detail={"url": payload.url, "family": payload.family, "rationale": payload.rationale},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    await session.refresh(row)
    return {"ok": True, "source": _record(row)}


@router.patch("/sources/registry/{key}")
async def update_source(
    key: str,
    payload: SourcePatch,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await _load(session, key)
    _check_enums(family=payload.family, kind=payload.kind)
    before = {"url": row.url, "kind": row.kind, "family": row.family}

    if payload.name is not None:
        row.name = payload.name.strip() or row.name
    if payload.family is not None:
        row.family = payload.family
    if payload.kind is not None:
        row.kind = payload.kind
    if payload.pathPattern is not None:
        row.path_pattern = payload.pathPattern or "/news/"
    if payload.domestic is not None:
        row.domestic = payload.domestic
    if payload.aiOnly is not None:
        row.ai_only = payload.aiOnly
    if payload.timeoutMs is not None:
        row.timeout_ms = payload.timeoutMs
    if payload.rationale is not None:
        row.rationale = payload.rationale[:2000]
    if payload.url is not None and payload.url != row.url:
        await validate_source_url(payload.url)
        row.url = payload.url

    # A different address or parser means the old probe proved nothing about the
    # new configuration: the row has to be re-verified before it can be enabled.
    changed_target = row.url != before["url"] or row.kind != before["kind"]
    if changed_target:
        row.verified_at = None
        row.enabled = False
    row.updated_at = utc_now()

    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="source.update",
        target_type="source",
        target_id=key,
        summary=f"update {key}" + (" (re-probe required)" if changed_target else ""),
        detail={**before, "url": row.url, "kind": row.kind, "family": row.family},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    await session.refresh(row)
    return {"ok": True, "source": _record(row), "probeRequired": changed_target}


@router.post("/sources/registry/{key}/enabled")
async def set_enabled(
    key: str,
    payload: EnabledRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await _load(session, key)
    if payload.enabled and row.verified_at is None:
        raise HTTPException(status_code=409, detail="probe_required")

    before = bool(row.enabled)
    row.enabled = payload.enabled
    row.updated_at = utc_now()
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="source.enable" if payload.enabled else "source.disable",
        target_type="source",
        target_id=key,
        summary=f"{'enable' if payload.enabled else 'disable'} {key}",
        detail={"from": before, "to": payload.enabled, "url": row.url},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    await session.refresh(row)
    return {"ok": True, "source": _record(row)}


@router.post("/sources/registry/{key}/verify")
async def verify_source(
    key: str,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Probe a stored row and, on success, stamp `verified_at`.

    This is the only way a source becomes enableable, so it has to be a server
    side action on a row rather than a value the client asserts.
    """
    row = await _load(session, key)
    probe = await _run_probe(
        ProbeRequest(
            url=row.url,
            kind=row.kind,
            key=row.key,
            name=row.name,
            family=row.family,
            pathPattern=row.path_pattern,
            timeoutMs=row.timeout_ms,
        )
    )
    if probe["ok"]:
        row.verified_at = utc_now()
        row.updated_at = row.verified_at
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="source.verify",
        target_type="source",
        target_id=key,
        summary=f"probe {key}: {'ok' if probe['ok'] else probe['error']} ({probe['itemCount']} items)",
        detail={"ok": probe["ok"], "error": probe["error"], "ms": probe["ms"]},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    await session.refresh(row)
    return {"ok": True, "probe": probe, "source": _record(row)}
