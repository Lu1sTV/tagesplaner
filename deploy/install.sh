#!/usr/bin/env bash
# Einrichtung des Tagesplaners in einem frischen Debian-LXC: klont das Repo,
# baut es und legt einen systemd-Service an.
#
# Im Container als root:
#   bash install.sh [passwort]
# Oder direkt aus dem Repo:
#   curl -fsSL https://raw.githubusercontent.com/Lu1sTV/tagesplaner/main/deploy/install.sh | bash -s -- [passwort]
set -euo pipefail

REPO=${REPO:-https://github.com/Lu1sTV/tagesplaner.git}
BRANCH=${BRANCH:-main}
APP_DIR=/opt/tagesplaner
DATA_DIR=/var/lib/tagesplaner
ENV_FILE=/etc/tagesplaner.env
USER_NAME=tagesplaner
TZ_NAME=${TZ_NAME:-Europe/Berlin}
PASSWORD=${1:-}

[[ $EUID -eq 0 ]] || { echo "Bitte als root ausführen."; exit 1; }

# Alles, was dem App-Benutzer gehoert, laeuft ueber runuser – sudo ist auf
# minimalen Debian-Images nicht installiert.
as_app() { runuser -u "$USER_NAME" -- env HOME="$APP_DIR" "$@"; }

echo "==> Pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git cron >/dev/null

# node:sqlite gibt es erst ab Node 22.5, Debians eigene Pakete sind zu alt.
if ! command -v node >/dev/null || [[ $(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0) -lt 24 ]]; then
  echo "==> Node 24 installieren"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pnpm >/dev/null || { echo "==> pnpm installieren"; npm install -g pnpm >/dev/null 2>&1; }
echo "    Node $(node --version), pnpm $(pnpm --version)"

echo "==> Zeitzone $TZ_NAME"
ln -sf "/usr/share/zoneinfo/$TZ_NAME" /etc/localtime
echo "$TZ_NAME" > /etc/timezone

echo "==> Benutzer und Verzeichnisse"
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR" "$DATA_DIR"

if [[ -d $APP_DIR/.git ]]; then
  echo "==> Repo aktualisieren"
  as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  as_app git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  echo "==> Repo klonen: $REPO ($BRANCH)"
  as_app git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

echo "==> Abhängigkeiten und Build"
as_app pnpm --dir "$APP_DIR" install --frozen-lockfile --silent
as_app pnpm --dir "$APP_DIR" build >/dev/null
echo "    dist/ gebaut: $(ls "$APP_DIR/dist/assets" | wc -l | tr -d ' ') Dateien"

if [[ ! -f $ENV_FILE ]]; then
  if [[ -z $PASSWORD ]]; then
    PASSWORD=$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 14)
    GENERATED=1
  fi
  cat > "$ENV_FILE" <<ENVEOF
# Zugangspasswort der App. Nach Änderung: systemctl restart tagesplaner
TODO_PASSWORD=$PASSWORD
TODO_DB=$DATA_DIR/tagesplaner.db
PORT=3000
# Bestimmt, wann der Tageswechsel stattfindet.
TZ=$TZ_NAME
ENVEOF
  chmod 600 "$ENV_FILE"
else
  echo "==> $ENV_FILE existiert schon – Passwort bleibt unverändert."
fi

echo "==> systemd-Service"
cat > /etc/systemd/system/tagesplaner.service <<'UNITEOF'
[Unit]
Description=Tagesplaner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tagesplaner
WorkingDirectory=/opt/tagesplaner
EnvironmentFile=/etc/tagesplaner.env
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=3

# Der Prozess braucht nur sein Verzeichnis und die Datenbank.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tagesplaner

[Install]
WantedBy=multi-user.target
UNITEOF

echo "==> Tägliches Backup (03:30, 14 Tage Aufbewahrung)"
cat > /etc/cron.d/tagesplaner-backup <<'CRONEOF'
30 3 * * * tagesplaner cd /opt/tagesplaner && TODO_DB=/var/lib/tagesplaner/tagesplaner.db /usr/bin/node server/backup.mjs /var/lib/tagesplaner/backups && find /var/lib/tagesplaner/backups -name '*.db' -mtime +14 -delete
CRONEOF

systemctl daemon-reload
systemctl enable --now tagesplaner >/dev/null 2>&1
sleep 2

IP=$(hostname -I | awk '{print $1}')
echo
if systemctl is-active --quiet tagesplaner; then
  echo "Läuft:  http://$IP:3000"
else
  echo "Service ist NICHT aktiv. Logs ansehen mit:  journalctl -u tagesplaner -n 40"
fi
if [[ ${GENERATED:-0} == 1 ]]; then
  echo "Passwort (generiert):  $PASSWORD"
  echo "  steht auch in:       $ENV_FILE"
fi
echo "Datenbank:             $DATA_DIR/tagesplaner.db"
echo "Updates später:        /opt/tagesplaner/deploy/update.sh"
