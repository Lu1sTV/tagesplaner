import { createServer } from 'node:http'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addTodo,
  getMeta,
  maybeRollover,
  openDb,
  readHistory,
  readState,
  removeTodo,
  setDone,
  setMeta,
  setOrder,
  setText,
} from './db.mjs'

const PORT = Number(process.env.PORT ?? 3000)
const DB_FILE = process.env.TODO_DB ?? 'tagesplaner.db'
const PASSWORD = process.env.TODO_PASSWORD
const STATIC_DIR = fileURLToPath(new URL('../dist/', import.meta.url))
const COOKIE = 'tagesplaner'

if (!PASSWORD) {
  console.error('TODO_PASSWORD ist nicht gesetzt – Start abgebrochen.')
  process.exit(1)
}

const db = openDb(DB_FILE)

// Server-Secret einmal erzeugen und in der DB halten: so bleiben Logins
// ueber Neustarts hinweg gueltig.
if (!getMeta(db, 'secret')) setMeta(db, 'secret', randomBytes(32).toString('hex'))
const token = createHmac('sha256', getMeta(db, 'secret')).update('v1').digest('hex')

const sha = (s) => createHash('sha256').update(String(s)).digest()
const equal = (a, b) => timingSafeEqual(sha(a), sha(b))

const authorized = (req) => {
  const raw = req.headers.cookie ?? ''
  const value = raw
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  return !!value && equal(value, token)
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 100_000) reject(new Error('Body zu gross'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('Ungueltiges JSON'))
      }
    })
    req.on('error', reject)
  })

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  // normalize + Praefix-Check verhindert ../-Ausbrueche aus dist/.
  const target = normalize(join(STATIC_DIR, path === '/' ? 'index.html' : path))
  const file = target.startsWith(STATIC_DIR) ? target : join(STATIC_DIR, 'index.html')

  for (const candidate of [file, join(STATIC_DIR, 'index.html')]) {
    try {
      const body = await readFile(candidate)
      const type = TYPES[extname(candidate)] ?? 'application/octet-stream'
      const cache = candidate.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
      res.writeHead(200, { 'content-type': type, 'cache-control': cache })
      return res.end(body)
    } catch {
      // naechster Kandidat: index.html als SPA-Fallback
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Nicht gefunden. Wurde `pnpm build` ausgefuehrt?')
}

async function handleApi(req, res, path) {
  if (path === '/api/login' && req.method === 'POST') {
    const { password } = await readBody(req)
    if (!password || !equal(password, PASSWORD)) {
      return json(res, 401, { error: 'Falsches Passwort' })
    }
    res.setHeader(
      'set-cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`,
    )
    return json(res, 200, { ok: true })
  }

  if (path === '/api/logout' && req.method === 'POST') {
    res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
    return json(res, 200, { ok: true })
  }

  if (!authorized(req)) return json(res, 401, { error: 'Nicht angemeldet' })

  maybeRollover(db)

  if (path === '/api/state' && req.method === 'GET') {
    return json(res, 200, readState(db))
  }

  if (path === '/api/history' && req.method === 'GET') {
    return json(res, 200, { days: readHistory(db) })
  }

  if (path === '/api/todos' && req.method === 'POST') {
    const { list, text } = await readBody(req)
    if (list !== 'today' && list !== 'tomorrow') return json(res, 400, { error: 'Liste unbekannt' })
    const clean = String(text ?? '').trim()
    if (!clean) return json(res, 400, { error: 'Text fehlt' })
    return json(res, 200, addTodo(db, list, clean.slice(0, 500)))
  }

  if (path === '/api/order' && req.method === 'POST') {
    const { today, tomorrow } = await readBody(req)
    if (!Array.isArray(today) || !Array.isArray(tomorrow)) {
      return json(res, 400, { error: 'Reihenfolge fehlt' })
    }
    setOrder(db, today, tomorrow)
    return json(res, 200, { ok: true })
  }

  const todo = path.match(/^\/api\/todos\/([\w-]+)$/)
  if (todo) {
    const id = todo[1]
    if (req.method === 'DELETE') {
      removeTodo(db, id)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'PATCH') {
      const patch = await readBody(req)
      if (typeof patch.done === 'boolean') setDone(db, id, patch.done)
      if (typeof patch.text === 'string' && patch.text.trim()) {
        setText(db, id, patch.text.trim().slice(0, 500))
      }
      return json(res, 200, { ok: true })
    }
  }

  return json(res, 404, { error: 'Route unbekannt' })
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  try {
    if (path.startsWith('/api/')) await handleApi(req, res, path)
    else await serveStatic(req, res)
  } catch (err) {
    console.error(err)
    if (!res.headersSent) json(res, 500, { error: 'Serverfehler' })
    else res.end()
  }
}).listen(PORT, () => {
  console.log(`Tagesplaner laeuft auf http://0.0.0.0:${PORT} (DB: ${DB_FILE})`)
})
