# Tagesplaner auf Proxmox (LXC)

Ziel: ein kleiner Debian-Container, in dem der Tagesplaner als systemd-Service läuft.
Kein Docker, keine Datenbank-Installation, **kein `npm install` auf dem Server** – der
Server-Teil benutzt ausschließlich eingebaute Node-Module.

Du brauchst dafür kein Community-Script: ein blanker Debian-Container reicht, und die
Einrichtung darin übernimmt `deploy/install.sh`.

---

## 1. Container-Template holen (einmalig)

In der Proxmox-Weboberfläche:

1. Links den Storage `local` anklicken → **CT Templates** → **Templates**
2. In der Liste `debian-13-standard` suchen → **Download**
   (`debian-12-standard` funktioniert genauso, falls 13 bei dir nicht auftaucht)

## 2. Container anlegen

Oben rechts **Create CT**:

| Tab | Einstellung |
|---|---|
| General | Hostname `tagesplaner`, **Unprivileged container** angehakt, Root-Passwort setzen |
| General | **SSH public key**: hier deinen öffentlichen Schlüssel einfügen – siehe Kasten unten |
| Template | Storage `local`, Template `debian-13-standard` |
| Disks | 4 GB reichen dicke |
| CPU | 1 Core |
| Memory | 512 MB RAM, 512 MB Swap |
| Network | IPv4 `DHCP` (oder eine feste IP, wenn du eine vergeben willst) |
| DNS | leer lassen = wie der Host |

> **SSH-Key**: auf dem Mac `cat ~/.ssh/id_ed25519.pub` ausgeben und den Inhalt einfügen.
> Falls du noch keinen hast: `ssh-keygen -t ed25519` (Enter durchdrücken), dann nochmal `cat`.
> Ohne Key kommst du später nicht per `ssh`/`rsync` rein, und `push.sh` funktioniert nicht.

Danach den Container starten. Die IP steht im Container unter **Summary**, oder per
Konsole mit `hostname -I`.

## 3. Einrichten

Vom Mac aus, mit der IP des Containers:

```bash
cd ~/empiriecom/workspace/tagesplaner
scp deploy/install.sh root@192.168.1.50:/tmp/
ssh root@192.168.1.50 bash /tmp/install.sh
```

Das Skript installiert Node 24, legt den Benutzer `tagesplaner` an, setzt die Zeitzone
auf `Europe/Berlin`, schreibt den systemd-Service und ein tägliches Backup.

Am Ende gibt es ein **generiertes Passwort** aus – das ist dein Login in der App.
Wenn du selbst eines setzen willst, gib es direkt mit:

```bash
ssh root@192.168.1.50 bash /tmp/install.sh MeinPasswort
```

Später ändern: `/etc/tagesplaner.env` bearbeiten, dann `systemctl restart tagesplaner`.

## 4. App hochladen und starten

```bash
deploy/push.sh root@192.168.1.50
```

Das baut das Frontend, kopiert `dist/` und `server/` in den Container und startet den
Service neu. Danach erreichbar unter:

```
http://192.168.1.50:3000
```

**Updates** laufen später genau gleich: `deploy/push.sh root@<ip>` – ein Befehl.

---

## Betrieb

```bash
ssh root@192.168.1.50

systemctl status tagesplaner      # läuft er?
journalctl -u tagesplaner -f      # Logs mitlesen
systemctl restart tagesplaner     # neustarten
```

**Datenbank**: `/var/lib/tagesplaner/tagesplaner.db` – eine einzelne SQLite-Datei.

**Backups**: täglich 03:30 nach `/var/lib/tagesplaner/backups/`, 14 Tage Aufbewahrung
(`/etc/cron.d/tagesplaner-backup`). Das läuft über `VACUUM INTO`, also konsistent im
laufenden Betrieb – der Service muss dafür nicht angehalten werden. Manuell:

```bash
sudo -u tagesplaner TODO_DB=/var/lib/tagesplaner/tagesplaner.db \
  node /opt/tagesplaner/server/backup.mjs /var/lib/tagesplaner/backups
```

Eine Kopie auf den Mac holen:

```bash
scp root@192.168.1.50:/var/lib/tagesplaner/backups/*.db ~/Downloads/
```

Zusätzlich deckt ein Proxmox-Backup (`vzdump`) des Containers alles mit ab – das ist
die bequemere Variante, wenn du im Datacenter eh schon einen Backup-Job hast.

## Zugriff von außerhalb des Heimnetzes

Aktuell hängt die App ohne TLS auf Port 3000 im LAN. Das Passwort geht damit im Klartext
über das Netz – im eigenen WLAN vertretbar, über das Internet nicht. Wenn du von unterwegs
drauf willst, nimm **Tailscale** oder WireGuard und lass den Port zu, statt ihn im Router
freizugeben. Ein Reverse-Proxy mit Let's-Encrypt-Zertifikat wäre die andere Variante.

Den Port nicht ins Internet portforwarden.

## Wenn etwas klemmt

**`install.sh` bricht bei Node ab.** Dann hat NodeSource für die Debian-Version kein
Paket. Node direkt installieren:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.9.0/node-v24.9.0-linux-x64.tar.xz
tar -xJf node-v24.9.0-linux-x64.tar.xz -C /usr/local --strip-components=1
node --version
```

Danach `bash /tmp/install.sh` nochmal laufen lassen.

**Seite lädt, aber es kommt „Wurde `pnpm build` ausgeführt?"** → `dist/` fehlt im
Container, also `deploy/push.sh root@<ip>` ausführen.

**Tageswechsel passiert zur falschen Zeit.** Zeitzone prüfen: `ssh root@<ip> date`.
Sie wird über `TZ` in `/etc/tagesplaner.env` gesetzt.

**`rsync`/`ssh` fragt nach einem Passwort.** Dann ist der SSH-Key nicht im Container
angekommen. Nachtragen: `ssh-copy-id root@<ip>`.
