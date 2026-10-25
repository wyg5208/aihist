#!/usr/bin/env bash
# One-time provisioning for a fresh Debian/Ubuntu VPS. Idempotent: re-running it
# only refreshes the virtualenv and replays the migrations.
#
# Prerequisites (run once by hand):
#   sudo adduser --system --group --home /srv/aihist aihist
#   sudo install -d -o aihist -g aihist /var/log/aihist
#   sudo install -d -o aihist -g aihist /srv/aihist/data     # holds aihist.db
#   sudo install -d -o root -g aihist -m 0750 /etc/aihist
#   sudo cp deploy/api.env.example /etc/aihist/api.env   # then edit the secrets
#
# No database server to provision: SQLite is one file inside $APP_DIR/data.
#
# usage: sudo -u aihist deploy/bootstrap.sh
set -euo pipefail

APP_DIR="${AIHIST_APP_DIR:-/srv/aihist}"
ENV_FILE="${AIHIST_ENV_FILE:-/etc/aihist/api.env}"

cd "$APP_DIR"

echo "==> virtualenv"
if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip wheel
"$APP_DIR/.venv/bin/python" -m pip install -e "$APP_DIR/backend"

echo "==> directories"
mkdir -p "$APP_DIR/data"

# The cron entries exec these directly; a copy without the mode bit fails with
# EACCES at 3am, which is exactly when nobody is looking.
echo "==> script permissions"
chmod 0755 "$APP_DIR"/deploy/*.sh

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

echo "==> migrations"
(cd "$APP_DIR/backend" && "$APP_DIR/.venv/bin/python" -m alembic upgrade head)

echo "==> seed"
"$APP_DIR/.venv/bin/python" -m app.cli seed

echo "==> static bundle"
if command -v npm >/dev/null 2>&1; then
  npm ci
  npm run build
  npm run check:pages
else
  echo "npm not found: build dist/ elsewhere and rsync it to $APP_DIR/dist" >&2
fi

echo "==> done. Next:"
echo "    sudo cp deploy/aihist-api.service /etc/systemd/system/"
echo "    sudo systemctl daemon-reload && sudo systemctl enable --now aihist-api"
echo "    sudo cp deploy/cron.d/aihist /etc/cron.d/aihist && sudo chmod 0644 /etc/cron.d/aihist"
