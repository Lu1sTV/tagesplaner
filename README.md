# Tagesplaner

Kleine Todo-App zum Planen des Tages: eine Liste für **Heute**, eine als Backlog für
**Morgen**, und ein **Rückblick** auf erledigte Tage. Läuft als Node-Server mit SQLite,
gedacht für den eigenen Homeserver.

## Lokal entwickeln

```bash
pnpm install
pnpm dev            # startet UI (:5180) und API (:3000), Passwort ist "dev"
```

`pnpm dev` zieht beide Prozesse hoch und beendet beide gemeinsam. Einzeln geht auch:
`pnpm dev:ui` und `pnpm dev:server`. Ohne den API-Server zeigt die Seite einen
Verbindungsfehler – wenn im Terminal `http proxy error: ECONNREFUSED` steht, läuft
Port 3000 nicht.

## Tests

```bash
pnpm test           # Sortier-Logik + End-to-End-Test der API
```

## Produktiv bauen und starten

```bash
pnpm build
TODO_PASSWORD=geheim TODO_DB=tagesplaner.db pnpm start   # alles auf :3000
```

Deployment auf einen Proxmox-LXC: siehe [DEPLOY.md](DEPLOY.md).

## Wie es funktioniert

- **Tageswechsel** macht der Server, geprüft vor jedem Request: erledigte Todos von
  „Heute" wandern ins Archiv, offene bleiben stehen, „Morgen" rutscht nach „Heute".
  Passiert also auch dann korrekt, wenn die App tagelang niemand offen hatte.
- **Sortieren** per Drag & Drop passiert während des Ziehens nur im Browser; erst beim
  Loslassen geht ein einzelner Request mit der neuen Reihenfolge raus.
- **Login** ist ein geteiltes Passwort (`TODO_PASSWORD`) plus HttpOnly-Cookie. Kein
  Benutzerkonzept – die App ist für eine Person gedacht.

## Dateien

| Pfad | Inhalt |
|---|---|
| `server/index.mjs` | HTTP-Server, Routen, Login, Ausliefern des Frontends |
| `server/db.mjs` | SQLite-Schema und alle Abfragen, Tageswechsel |
| `server/backup.mjs` | Konsistentes Backup im laufenden Betrieb |
| `src/App.tsx` | Komplette Oberfläche |
| `src/api.ts` | Fetch-Aufrufe gegen die API |
| `src/order.ts` | Sortier-Logik als pure Funktion (getestet) |
| `deploy/` | `install.sh` richtet den LXC ein, `update.sh` zieht Updates |

Keine Laufzeit-Dependencies: der Server benutzt nur eingebaute Node-Module
(`node:http`, `node:sqlite`, `node:crypto`). React und Vite sind reine Build-Zeit.
