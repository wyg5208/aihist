"""First-party analytics: UA classification, access-log parsing, and digests.

The one rule this package exists to enforce: a value that identifies a person
never reaches the database. Callers hand us a raw IP or a random client id and
get back a hex digest; there is no helper here that returns the input.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta, timezone

from app.config import Settings

# `tzdata` is not guaranteed on Windows, so the calendar day is derived from a
# fixed offset rather than a named zone. China has no DST, so UTC+8 is exact.
LOCAL_TZ = timezone(timedelta(hours=8))


def salt_for(settings: Settings) -> str:
    """The pepper mixed into every digest.

    Falling back to `SESSION_SECRET` means a deployment cannot accidentally run
    with an empty salt, which would make the digests reversible by dictionary.
    """
    return settings.analytics_salt or settings.session_secret or "aihist-development-salt"


def digest(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def ip_digest(ip: str, settings: Settings) -> str:
    """Audit-log friendly fingerprint of a client address."""
    if not ip:
        return ""
    return digest(ip, salt_for(settings))[:64]


def day_digest(value: str, settings: Settings, day: str) -> str:
    """A per-day pseudo-identity.

    Mixing the day in means yesterday's digest and today's digest of the same
    visitor cannot be joined, so `count(distinct visitor_hash)` per day is as
    much linkage as the schema permits.
    """
    if not value:
        return ""
    return digest(value, salt_for(settings), day)


def local_day(moment) -> str:
    """`YYYY-MM-DD` on the UTC+8 calendar."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(LOCAL_TZ).strftime("%Y-%m-%d")


__all__ = ["LOCAL_TZ", "day_digest", "digest", "ip_digest", "local_day", "salt_for"]
