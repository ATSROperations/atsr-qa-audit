#!/usr/bin/env bash
# Update the app from GitHub (branch main) and restart it if the code changed.
# Run as root: by the atsr-qa-update timer, or by hand with  sudo bash /opt/atsr-qa-audit/app/deploy/update.sh
# The database lives in /var/lib/atsr-qa-audit and is never touched.
set -euo pipefail
APP=/opt/atsr-qa-audit/app
BRANCH=main
ENV_FILE=/etc/atsr-qa-audit.env

# Read the app's port from its settings file (falls back to 3100).
PORT=$(grep '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
PORT=${PORT:-3100}

cd "$APP"
sudo -H -u atsrqa git fetch --quiet origin "$BRANCH"
LOCAL=$(sudo -H -u atsrqa git rev-parse HEAD)
REMOTE=$(sudo -H -u atsrqa git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then exit 0; fi
sudo -H -u atsrqa git reset --quiet --hard "origin/$BRANCH"
chmod +x "$APP/deploy/update.sh"
systemctl restart atsr-qa-audit

# Give the app up to 20 seconds to answer on its own port.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "Updated $LOCAL -> $REMOTE"
    exit 0
  fi
  sleep 2
done
echo "Updated to $REMOTE but the app did not answer on port $PORT. Check: journalctl -u atsr-qa-audit -n 50" >&2
exit 1
