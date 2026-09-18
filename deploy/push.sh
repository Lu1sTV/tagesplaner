#!/usr/bin/env bash
# Baut das Frontend und schiebt App + Server auf den LXC, dann Neustart.
# Aufruf:  deploy/push.sh root@192.168.1.50
set -euo pipefail

HOST=${1:-}
[[ -n $HOST ]] || { echo "Aufruf: deploy/push.sh root@<ip-des-lxc>"; exit 1; }
cd "$(dirname "$0")/.."

echo "==> Bauen"
pnpm build

echo "==> Hochladen nach $HOST:/opt/tagesplaner"
# --delete raeumt alte, gehashte Asset-Dateien auf.
rsync -az --delete dist/ "$HOST:/opt/tagesplaner/dist/"
rsync -az --delete --exclude '*.test.mjs' server/ "$HOST:/opt/tagesplaner/server/"
ssh "$HOST" "chown -R tagesplaner:tagesplaner /opt/tagesplaner && systemctl restart tagesplaner"

echo "==> Status"
ssh "$HOST" "systemctl is-active tagesplaner && systemctl --no-pager -l status tagesplaner | head -6"
