#!/usr/bin/env bash
# Nightly online backup, 14 days of history. The archive only changes six times
# a day, so this is a safety net for schema or accidental-delete damage rather
# than a point-in-time recovery story.
#
# `cp aihist.db` is NOT a backup under WAL: it can capture a torn snapshot.
# `deploy/backup.py` uses the SQLite backup API instead, which is safe on a
# live database.
#
# usage: deploy/backup.sh
set -euo pipefail

BACKUP_DIR="${AIHIST_BACKUP_DIR:-/var/backups/aihist}"
RETENTION_DAYS="${AIHIST_BACKUP_DAYS:-14}"
ENV_FILE="${AIHIST_ENV_FILE:-/etc/aihist/api.env}"
APP_DIR="${AIHIST_APP_DIR:-/srv/aihist}"

if [[ -r "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/aihist-$STAMP.db"

# A Postgres deployment keeps the old dump path; SQLite uses the backup API.
if [[ "${DATABASE_URL:?DATABASE_URL is not set}" == postgresql* ]]; then
  PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgresql\+[a-z0-9]+://#postgresql://#')"
  TARGET="${BACKUP_DIR}/aihist-$STAMP.dump"
  pg_dump --format=custom --no-owner --no-privileges --dbname="$PG_URL" --file="$TARGET"
  PATTERN='aihist-*.dump'
else
  "$APP_DIR/.venv/bin/python" "$APP_DIR/deploy/backup.py" "$TARGET" >/dev/null
  PATTERN='aihist-*.db'
fi

printf '%s backup written: %s (%s)\n' "$(date -u +%FT%TZ)" "$TARGET" "$(du -h "$TARGET" | cut -f1)"

# Anything older than the retention window goes away.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "$PATTERN" -mtime "+$RETENTION_DAYS" -delete
