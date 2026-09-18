import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

/** Lokaler Tag als YYYY-MM-DD – bewusst in JS, nicht in SQL, um Zeitzonen-Fallen zu vermeiden. */
export function localDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function openDb(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      list       TEXT NOT NULL CHECK (list IN ('today', 'tomorrow', 'archive')),
      done       INTEGER NOT NULL DEFAULT 0,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      done_at    TEXT,
      done_day   TEXT
    );
    CREATE INDEX IF NOT EXISTS todos_list_pos ON todos (list, position);
    CREATE INDEX IF NOT EXISTS todos_done_day ON todos (done_day);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  return db
}

const getMeta = (db, key) =>
  db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null

const setMeta = (db, key, value) =>
  db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?')
    .run(key, value, value)

export { getMeta, setMeta }

const activeList = (db, list) =>
  db
    .prepare('SELECT id, text, done FROM todos WHERE list = ? ORDER BY position, created_at')
    .all(list)
    .map((r) => ({ id: r.id, text: r.text, done: !!r.done }))

/**
 * Tageswechsel: erledigte Todos von "Heute" wandern ins Archiv, offene bleiben
 * stehen, danach rutscht "Morgen" nach "Heute". Laeuft vor jedem Request –
 * so stimmt der Stand auch, wenn der Server tagelang niemand aufgerufen hat.
 */
export function maybeRollover(db) {
  const day = localDay()
  if (getMeta(db, 'last_day') === day) return false

  db.exec('BEGIN')
  try {
    // Erledigte von heute archivieren. done_day ist schon beim Abhaken gesetzt.
    db.prepare("UPDATE todos SET list = 'archive' WHERE list = 'today' AND done = 1").run()

    const open = db
      .prepare("SELECT id FROM todos WHERE list = 'today' ORDER BY position, created_at")
      .all()
    const backlog = db
      .prepare("SELECT id FROM todos WHERE list = 'tomorrow' ORDER BY position, created_at")
      .all()

    const setPos = db.prepare("UPDATE todos SET list = 'today', position = ? WHERE id = ?")
    ;[...open, ...backlog].forEach((row, i) => setPos.run(i, row.id))

    setMeta(db, 'last_day', day)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}

export function readState(db) {
  return { today: activeList(db, 'today'), tomorrow: activeList(db, 'tomorrow'), day: localDay() }
}

export function addTodo(db, list, text) {
  const id = randomUUID()
  const next =
    (db.prepare('SELECT MAX(position) AS m FROM todos WHERE list = ?').get(list)?.m ?? -1) + 1
  db.prepare(
    'INSERT INTO todos (id, text, list, done, position, created_at) VALUES (?, ?, ?, 0, ?, ?)',
  ).run(id, text, list, next, new Date().toISOString())
  return { id, text, done: false }
}

export function setDone(db, id, done) {
  const now = new Date()
  db.prepare('UPDATE todos SET done = ?, done_at = ?, done_day = ? WHERE id = ?').run(
    done ? 1 : 0,
    done ? now.toISOString() : null,
    done ? localDay(now) : null,
    id,
  )
}

export function setText(db, id, text) {
  db.prepare('UPDATE todos SET text = ? WHERE id = ?').run(text, id)
}

export function removeTodo(db, id) {
  db.prepare('DELETE FROM todos WHERE id = ?').run(id)
}

/** Schreibt die Reihenfolge beider Listen neu – ein Aufruf deckt Sortieren und Verschieben ab. */
export function setOrder(db, today, tomorrow) {
  const stmt = db.prepare('UPDATE todos SET list = ?, position = ? WHERE id = ? AND list != ?')
  db.exec('BEGIN')
  try {
    today.forEach((id, i) => stmt.run('today', i, id, 'archive'))
    tomorrow.forEach((id, i) => stmt.run('tomorrow', i, id, 'archive'))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Rueckblick: archivierte Todos nach Tag gruppiert, neueste zuerst. */
export function readHistory(db, days = 60) {
  const rows = db
    .prepare(
      `SELECT id, text, done_day FROM todos
       WHERE list = 'archive' AND done_day IS NOT NULL
       ORDER BY done_day DESC, position`,
    )
    .all()

  const byDay = new Map()
  for (const row of rows) {
    if (!byDay.has(row.done_day)) {
      if (byDay.size >= days) continue
      byDay.set(row.done_day, [])
    }
    byDay.get(row.done_day).push({ id: row.id, text: row.text })
  }
  return [...byDay].map(([day, todos]) => ({ day, todos }))
}
