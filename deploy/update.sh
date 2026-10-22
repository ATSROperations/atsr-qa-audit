#!/usr/bin/env bash
# Update the app from GitHub (branch main) and restart it if the code changed.
# Run as root: by the atsr-qa-update timer, or by hand with  sudo /opt/atsr-qa-audit/app/deploy/update.sh
# The database lives in /var/lib/atsr-qa-audit and is never touched.
set -euo pipefail
APP=/opt/atsr-qa-audit/app
BRANCH=main
cd "$APP"
sudo -H -u atsrqa git fetch --quiet origin "$BRANCH"
LOCAL=$(sudo -H -u atsrqa git rev-parse HEAD)
REMOTE=$(sudo -H -u atsrqa git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then exit 0; fi
sudo -H -u atsrqa git reset --quiet --hard "origin/$BRANCH"
chmod +x "$APP/deploy/update.sh"
systemctl restart atsr-qa-audit
sleep 2
if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then
  echo "Updated $LOCAL -> $REMOTE"
else
  echo "Updated to $REMOTE but the app did not answer. Check: journalctl -u atsr-qa-audit -n 50" >&2
  exit 1
fi
