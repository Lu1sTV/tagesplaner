// End-to-End-Test der API: startet den Server mit einer Wegwerf-DB und klappert
// alle Routen ab, inklusive simuliertem Tageswechsel.
// Laufen lassen mit: pnpm test:api
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 3099
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'geheim'

const dir = await mkdtemp(join(tmpdir(), 'tagesplaner-test-'))
const dbFile = join(dir, 'test.db')

const server = spawn(process.execPath, [new URL('index.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT: String(PORT), TODO_DB: dbFile, TODO_PASSWORD: PASSWORD },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}

let cookie = ''
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.getSetCookie?.()[0]
  if (setCookie) cookie = setCookie.split(';')[0]
  return { status: res.status, body: await res.json() }
}

const texts = (list) => list.map((t) => t.text + (t.done ? '*' : ''))

try {
  // Warten bis der Server hoert
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(BASE + '/api/state')
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  check('ohne Cookie -> 401', (await call('GET', '/api/state')).status, 401)
  check('falsches Passwort -> 401', (await call('POST', '/api/login', { password: 'nope' })).status, 401)
  check('kein Cookie nach Fehlversuch', cookie, '')
  check('richtiges Passwort -> 200', (await call('POST', '/api/login', { password: PASSWORD })).status, 200)
  check('Cookie ist HttpOnly-Token', cookie.startsWith('tagesplaner='), true)

  const a = (await call('POST', '/api/todos', { list: 'today', text: 'Einkaufen' })).body
  const b = (await call('POST', '/api/todos', { list: 'today', text: 'Steuer' })).body
  const c = (await call('POST', '/api/todos', { list: 'tomorrow', text: 'Arzt' })).body

  let state = (await call('GET', '/api/state')).body
  check('heute nach Anlegen', texts(state.today), ['Einkaufen', 'Steuer'])
  check('morgen nach Anlegen', texts(state.tomorrow), ['Arzt'])

  check('Anlegen liefert created zurueck', typeof a.created === 'string' && a.created.includes('T'), true)
  check('created kommt auch im State mit', typeof state.today[0].created, 'string')
  check('leerer Text -> 400', (await call('POST', '/api/todos', { list: 'today', text: '  ' })).status, 400)
  check('unbekannte Liste -> 400', (await call('POST', '/api/todos', { list: 'gestern', text: 'x' })).status, 400)

  // Sortieren innerhalb einer Liste
  await call('POST', '/api/order', { today: [b.id, a.id], tomorrow: [c.id] })
  state = (await call('GET', '/api/state')).body
  check('umsortiert', texts(state.today), ['Steuer', 'Einkaufen'])

  // Verschieben zwischen den Listen, derselbe Endpunkt
  await call('POST', '/api/order', { today: [b.id, c.id, a.id], tomorrow: [] })
  state = (await call('GET', '/api/state')).body
  check('Arzt nach heute gezogen', texts(state.today), ['Steuer', 'Arzt', 'Einkaufen'])
  check('morgen leer', state.tomorrow, [])

  await call('PATCH', `/api/todos/${a.id}`, { done: true })
  await call('PATCH', `/api/todos/${b.id}`, { text: 'Steuererklaerung' })
  state = (await call('GET', '/api/state')).body
  check('abgehakt + umbenannt', texts(state.today), ['Steuererklaerung', 'Arzt', 'Einkaufen*'])

  await call('DELETE', `/api/todos/${c.id}`)
  state = (await call('GET', '/api/state')).body
  check('geloescht', texts(state.today), ['Steuererklaerung', 'Einkaufen*'])
  check('Historie noch leer', (await call('GET', '/api/history')).body.days, [])

  // Tageswechsel simulieren: Erledigtes auf gestern datieren, Stichtag zuruecksetzen.
  const db = new DatabaseSync(dbFile)
  db.prepare("UPDATE meta SET value = '2000-01-01' WHERE key = 'last_day'").run()
  db.prepare("UPDATE todos SET done_day = '2026-09-17' WHERE done = 1").run()
  await call('POST', '/api/todos', { list: 'tomorrow', text: 'Backlog-Eintrag' })
  db.prepare("UPDATE meta SET value = '2000-01-01' WHERE key = 'last_day'").run()
  db.close()

  state = (await call('GET', '/api/state')).body
  check('nach Tageswechsel: offen bleibt, Backlog rutscht nach', texts(state.today), [
    'Steuererklaerung',
    'Backlog-Eintrag',
  ])
  check('morgen nach Tageswechsel leer', state.tomorrow, [])

  const history = (await call('GET', '/api/history')).body.days
  check('Historie hat den Tag', history.map((d) => d.day), ['2026-09-17'])
  check('Historie hat das Todo', history[0]?.todos.map((t) => t.text), ['Einkaufen'])

  // Zweiter Aufruf darf nicht erneut rollen
  const again = (await call('GET', '/api/state')).body
  check('Tageswechsel ist idempotent', texts(again.today), texts(state.today))

  await call('POST', '/api/logout')
  check('nach Logout -> 401', (await call('GET', '/api/state')).status, 401)
} catch (err) {
  fails++
  console.error('\nTest abgebrochen:', err.message)
  console.error('Server-Log:\n' + serverLog)
} finally {
  server.kill()
  await rm(dir, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle API-Tests gruen')
process.exit(fails ? 1 : 0)
