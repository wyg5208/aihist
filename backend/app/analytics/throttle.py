"""A process-local sliding window for the public HTML forms.

Both public forms — the API application and the subscribe form — need the same
cheap guard, and both run in the single worker this service assumes, so a dict
of timestamps is the honest implementation: a cache, not state, and lost on
restart, which is what "five per hour, per caller" can tolerate.

It lives here rather than in either router because a second copy of this logic
is how the two forms quietly drift to different limits.
"""

from __future__ import annotations

import time

MAX_KEYS = 4096


class SlidingWindow:
    """Counts calls per key; `allow` is the only decision this makes."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, *, moment: float | None = None) -> bool:
        now = time.monotonic() if moment is None else moment
        cutoff = now - self.window_seconds
        stamps = [stamp for stamp in self._hits.get(key, ()) if stamp >= cutoff]
        if len(stamps) >= self.limit:
            self._hits[key] = stamps
            return False
        if len(self._hits) > MAX_KEYS:
            self._hits.clear()
        stamps.append(now)
        self._hits[key] = stamps
        return True

    def reset(self) -> None:
        """Testing seam."""
        self._hits.clear()


__all__ = ["SlidingWindow"]
