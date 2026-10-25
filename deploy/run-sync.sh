#!/usr/bin/env bash
# One collection pass, run from cron. Loads the same environment file the API
# process uses so the CLI cannot drift from the service.
#
# usage: deploy/run-sync.sh [auto|manual]
set -euo pipefail

TRIGGER="${1:-auto}"
ENV_FILE="${AIHIST_ENV_FILE:-/etc/aihist/api.env}"
APP_DIR="${AIHIST_APP_DIR:-/srv/aihist}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "run-sync: cannot read $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$APP_DIR"
# Non-zero exit on a failed run is deliberate: cron mails the operator when
# MAILTO is set, and the run row in the database carries the details either way.
exec "$APP_DIR/.venv/bin/python" -m app.cli sync --trigger "$TRIGGER"
