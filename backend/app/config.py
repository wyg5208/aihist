"""Runtime configuration.

Every value comes from the environment; nothing is read from a request.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# `backend/app/config.py` -> `backend/` -> repository root.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_DIR.parent

# Resolved against the source tree, not the working directory, so
# `python -m uvicorn app.main:app` behaves the same from `backend/` and from the
# repository root. The root file wins when both exist. Production passes real
# environment variables and may ship no file at all.
_ENV_FILES = (_BACKEND_DIR / ".env", _REPO_ROOT / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES, env_file_encoding="utf-8", extra="ignore"
    )

    # SQLite by default: one file, no server to run. A relative path resolves
    # against the working directory, which is why an absolute path is the safer
    # choice (`sqlite+aiosqlite:///D:/srv/aihist/data/aihist.db` on Windows,
    # `sqlite+aiosqlite:////srv/aihist/data/aihist.db` on Linux). Switching back
    # to Postgres is a one-line change: postgresql+psycopg://user:pass@host/db
    database_url: str = "sqlite+aiosqlite:///./aihist.db"

    # Admin session. `admin_password_hash` is an argon2 hash, never a password.
    session_secret: str = ""
    admin_user: str = "admin"
    admin_password_hash: str = ""
    session_max_age_seconds: int = 12 * 3600

    # Optional LLM summary pass. Absent configuration simply skips the stage.
    llm_api_base: str = ""
    llm_api_key: str = ""
    llm_model: str = ""

    # Five-vendor editorial panel: one slot per vendor (DeepSeek, Qwen, GLM,
    # Kimi, MiniMax). `_PROVIDER` selects a preset from `editorial/providers.py`
    # (base plus a default model plus that vendor's thinking kill switch);
    # `_MODEL` / `_BASE` still override it, and the shared gateway below covers
    # any slot that names neither a provider nor its own endpoint.
    editorial_judge_base: str = ""
    editorial_judge_key: str = ""
    editorial_judge_models: str = ""
    editorial_judge_timeout_ms: int = 90000
    editorial_judge_1_provider: str = ""
    editorial_judge_1_model: str = ""
    editorial_judge_1_base: str = ""
    editorial_judge_1_key: str = ""
    editorial_judge_2_provider: str = ""
    editorial_judge_2_model: str = ""
    editorial_judge_2_base: str = ""
    editorial_judge_2_key: str = ""
    editorial_judge_3_provider: str = ""
    editorial_judge_3_model: str = ""
    editorial_judge_3_base: str = ""
    editorial_judge_3_key: str = ""
    editorial_judge_4_provider: str = ""
    editorial_judge_4_model: str = ""
    editorial_judge_4_base: str = ""
    editorial_judge_4_key: str = ""
    editorial_judge_5_provider: str = ""
    editorial_judge_5_model: str = ""
    editorial_judge_5_base: str = ""
    editorial_judge_5_key: str = ""

    # A full run used to be capped by the edge runtime. On a VPS the only
    # limit that matters is "does not hang forever".
    run_budget_seconds: int = 300
    fetch_budget_seconds: int = 120

    site_origin: str = "https://aihist.net"

    # First-party analytics. Disabled means `POST /api/v1/track` answers 204 and
    # writes nothing, so the beacon can stay wired up on the client while the
    # operator buys themselves peace (`database is locked` during a long run).
    analytics_enabled: bool = True
    # Empty falls back to SESSION_SECRET, which every deployment already sets.
    analytics_salt: str = ""
    analytics_retention_days: int = 180
    # Reverse-proxy access log. This is the only source that sees the static
    # reference pages, which carry no JavaScript by design.
    analytics_log_path: str = ""
    analytics_log_format: str = "auto"

    # Open-data API. Off by default: turning it on is a commercial decision, not
    # a deployment detail.
    open_api_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
