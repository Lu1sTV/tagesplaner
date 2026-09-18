# Tagesplaner auf Proxmox (LXC)

Ein kleiner Debian-Container, der das Repo klont, baut und als systemd-Service laufen
lässt. Kein Docker, keine Datenbank-Installation, kein Reverse-Proxy nötig.

Du brauchst kein Community-Script – ein blanker Debian-Container reicht, die Einrichtung
darin macht `deploy/install.sh` in einem Befehl.

---

## 1. Container-Template holen (einmalig)

In der Proxmox-Weboberfläche:

1. Links den Storage `local` anklicken → **CT Templates** → **Templates**
2. `debian-13-standard` suchen → **Download**
   (`debian-12-standard` geht genauso, falls 13 nicht auftaucht)

## 2. Container anlegen

Oben rechts **Create CT**:

| Tab | Einstellung |
|---|---|
| General | Hostname `tagesplaner`, **Unprivileged container** angehakt, Root-Passwort setzen |
| Template | Storage `local`, Template `debian-13-standard` |
| Disks | 4 GB |
| CPU | 1 Core (2 macht den Build flotter) |
| Memory | **1024 MB** RAM, 512 MB Swap |
| Network | IPv4 `DHCP`, oder eine feste IP wenn du eine vergeben willst |
| DNS | leer lassen = wie der Host |

> **Warum 1 GB RAM?** Der Container baut das Frontend selbst, und `vite build` braucht
> dafür kurzzeitig mehr als 512 MB. Im Betrieb liegt die App danach bei ~60 MB, du kannst
> den RAM also später wieder runterdrehen, wenn du magst.

Container starten. Einen SSH-Key brauchst du nicht – die Einrichtung läuft über die
Proxmox-Konsole. (Wenn du später bequem per `ssh` reinwillst, kannst du den Key beim
Anlegen im General-Tab eintragen.)

## 3. Einrichten

Im Container die **Console** öffnen (in Proxmox links den Container anklicken →
**Console**), als `root` anmelden und einen Befehl ausführen:

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/Lu1sTV/tagesplaner/main/deploy/install.sh | bash -s -- MeinPasswort
```

Das `apt-get install curl` davor ist nötig, weil die Debian-Templates kein `curl`
mitbringen – und ohne `curl` lässt sich das Skript nicht herunterladen.

`MeinPasswort` ist dein späterer Login in der App – such dir was aus. Lässt du es weg,
generiert das Skript eines und zeigt es am Ende an.

Das Skript installiert Node 24 und pnpm, klont das Repo nach `/opt/tagesplaner`, baut das
Frontend, setzt die Zeitzone auf `Europe/Berlin`, legt den systemd-Service an und richtet
ein tägliches Backup ein. Am Ende steht die URL:

```
Läuft:  http://192.168.1.50:3000
```

Das war's – Seite im Browser öffnen, Passwort eingeben, fertig.

## 4. Updates

Du änderst etwas auf dem Mac, committest und pushst:

```bash
git add -A && git commit -m "..." && git push
```

Dann im Container (Console oder per SSH):

```bash
/opt/tagesplaner/deploy/update.sh
```

Das holt den neuen Stand, baut neu, startet den Service und prüft, ob er hochkommt –
wenn nicht, zeigt es direkt die Logzeilen. Per SSH als Einzeiler:

```bash
ssh root@192.168.1.50 /opt/tagesplaner/deploy/update.sh
```

---

## Betrieb

```bash
systemctl status tagesplaner      # läuft er?
journalctl -u tagesplaner -f      # Logs mitlesen
systemctl restart tagesplaner     # neustarten
```

**Passwort ändern**: `/etc/tagesplaner.env` bearbeiten, dann
`systemctl restart tagesplaner`. Die Datei wird bei Updates **nicht** angefasst.

**Datenbank**: `/var/lib/tagesplaner/tagesplaner.db` – eine einzelne SQLite-Datei.
Sie liegt außerhalb von `/opt/tagesplaner`, ein `git reset` beim Update kann ihr also
nichts tun.

**Backups**: täglich 03:30 nach `/var/lib/tagesplaner/backups/`, 14 Tage Aufbewahrung
(`/etc/cron.d/tagesplaner-backup`). Läuft über `VACUUM INTO`, also konsistent im laufenden
Betrieb – der Service muss dafür nicht angehalten werden. Manuell:

```bash
runuser -u tagesplaner -- env TODO_DB=/var/lib/tagesplaner/tagesplaner.db \
  node /opt/tagesplaner/server/backup.mjs /var/lib/tagesplaner/backups
```

Eine Kopie auf den Mac holen:

```bash
scp root@192.168.1.50:/var/lib/tagesplaner/backups/*.db ~/Downloads/
```

Ein Proxmox-Backup (`vzdump`) des Containers deckt zusätzlich alles mit ab.

## Zugriff von außerhalb des Heimnetzes

Die App hängt ohne TLS auf Port 3000 im LAN. Das Passwort geht damit im Klartext über das
Netz – im eigenen WLAN vertretbar, über das Internet nicht. Für unterwegs nimm
**Tailscale** oder WireGuard, statt den Port im Router freizugeben. Die andere Variante
wäre ein Reverse-Proxy mit Let's-Encrypt-Zertifikat.

Port 3000 nicht ins Internet portforwarden.

## Wenn etwas klemmt

**`install.sh` bricht bei Node ab.** Dann hat NodeSource für die Debian-Version kein
Paket. Node direkt installieren und das Skript nochmal laufen lassen:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.9.0/node-v24.9.0-linux-x64.tar.xz
tar -xJf node-v24.9.0-linux-x64.tar.xz -C /usr/local --strip-components=1
node --version
```

**Build wird „Killed" oder bricht ohne Meldung ab.** Zu wenig RAM. Container auf 1 GB
hochdrehen (Proxmox → Container → Resources → Memory), neu starten,
`/opt/tagesplaner/deploy/update.sh`.

**Seite sagt „Wurde `pnpm build` ausgeführt?"** → `dist/` fehlt, also Build ist
fehlgeschlagen. `/opt/tagesplaner/deploy/update.sh` zeigt den Fehler.

**Tageswechsel passiert zur falschen Zeit.** `date` im Container prüfen. Die Zeitzone
kommt aus `TZ` in `/etc/tagesplaner.env`.

**`install.sh` klont ein privates Repo nicht.** Bei einem privaten Repo braucht der
Container einen Deploy-Key. Alternative ohne Key: Repo öffentlich lassen (es enthält
keine Passwörter – die stehen nur in `/etc/tagesplaner.env` auf dem Server).
