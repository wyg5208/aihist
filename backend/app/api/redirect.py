"""`/go/<code>` — the only outbound link the site owns.

Why a redirector instead of putting the sponsor's URL straight into the page:
a click is the deliverable a sponsorship is priced on, and an `<a href>` gives
the operator nothing to invoice against. The row written here is also the
honest one — day, referrer host, UA family, bot flag — so "1,204 clicks" can be
taken apart twelve months later.

Two rules that look like bugs and are not:

* an unknown or expired code redirects to `/` with a 302 rather than a 404.
  A visitor tapping a stale link is a reader, not a tester; and a 404 page would
  tell a scanner exactly which codes exist.
* the redirect is `no-store`. A cached 302 would make the second click free of
  charge to the ledger, which is the one number the partner is watching.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import local_day
from app.db import repo_commercial
from app.db.models import utc_now
from app.deps import get_session

router = APIRouter()

NO_STORE = {"cache-control": "no-store, max-age=0"}


def _home() -> RedirectResponse:
    return RedirectResponse(url="/", status_code=302, headers=NO_STORE)


@router.get("/go/{code}")
async def follow(
    code: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    moment = utc_now()
    row = await repo_commercial.find_partner_by_code(session, code)
    if row is None or not repo_commercial.partner_is_live(row, today=local_day(moment)):
        return _home()

    await repo_commercial.record_click(
        session,
        row,
        user_agent=request.headers.get("user-agent") or "",
        referrer=request.headers.get("referer") or "",
        now=moment,
    )
    await session.commit()
    return RedirectResponse(
        url=repo_commercial.normalize_target(row.target_url), status_code=302, headers=NO_STORE
    )


__all__ = ["router"]
