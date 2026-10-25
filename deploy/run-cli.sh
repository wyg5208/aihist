#!/usr/bin/env bash
# Run any `app.cli` subcommand from cron with the service's environment.
#
# This exists for the same reason run-sync.sh does: cron has no venv and no env
# file, and a CLI that resolved a different DATABASE_URL than the API would
# write analytics rows into a database nobody ever reads.
#
# It is also the only place where the exit-code contract is visible: the two
# scheduled analytics jobs go through here and always exit 0, because a cron
# job that fails teaches an operator to stop reading cron mail.
#
# usage: deploy/run-cli.sh ingest-access-log [args...]
#        deploy/run-cli.sh prune
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "run-cli: missing subcommand" >&2
  exit 2
fi

ENV_FILE="${AIHIST_ENV_FILE:-/etc/aihist/api.env}"
APP_DIR="${AIHIST_APP_DIR:-/srv/aihist}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "run-cli: cannot read $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$APP_DIR"
exec "$APP_DIR/.venv/bin/python" -m app.cli "$@"
