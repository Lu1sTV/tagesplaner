// Konsistentes Backup im laufenden Betrieb: VACUUM INTO schreibt eine
// aufgeraeumte Kopie der DB, ohne den Server anzuhalten.
// Aufruf: node server/backup.mjs [ziel-verzeichnis]
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { localDay } from './db.mjs'

const source = process.env.TODO_DB ?? 'tagesplaner.db'
const dir = process.argv[2] ?? 'backups'
mkdirSync(dir, { recursive: true })

const target = join(dir, `tagesplaner-${localDay()}.db`)
const db = new DatabaseSync(source, { readOnly: true })
db.prepare('VACUUM INTO ?').run(target)
db.close()
console.log(`Backup geschrieben: ${target}`)
