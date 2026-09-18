#!/usr/bin/env bash
# Update im Container: neuesten Stand holen, bauen, Service neu starten.
# Aufruf als root:  /opt/tagesplaner/deploy/update.sh
set -euo pipefail

APP_DIR=/opt/tagesplaner
USER_NAME=tagesplaner
BRANCH=${BRANCH:-main}

[[ $EUID -eq 0 ]] || { echo "Bitte als root ausführen."; exit 1; }
as_app() { runuser -u "$USER_NAME" -- env HOME="$APP_DIR" "$@"; }

echo "==> Stand holen"
as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
BEFORE=$(as_app git -C "$APP_DIR" rev-parse HEAD)
as_app git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
AFTER=$(as_app git -C "$APP_DIR" rev-parse HEAD)

if [[ $BEFORE == "$AFTER" ]]; then
  echo "    schon aktuell (${AFTER:0:8}) – baue trotzdem neu."
else
  echo "    ${BEFORE:0:8} -> ${AFTER:0:8}"
fi

echo "==> Abhängigkeiten und Build"
as_app pnpm --dir "$APP_DIR" install --frozen-lockfile --silent
as_app pnpm --dir "$APP_DIR" build >/dev/null

echo "==> Neustart"
systemctl restart tagesplaner
sleep 2
if systemctl is-active --quiet tagesplaner; then
  echo "    läuft"
else
  echo "    FEHLER – die letzten Logzeilen:"
  journalctl -u tagesplaner -n 20 --no-pager
  exit 1
fi
