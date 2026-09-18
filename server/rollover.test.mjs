// Szenario-Test fuer den Tageswechsel ueber mehrere Tage Pause hinweg
// (Wochenende, Urlaub). Laeuft direkt gegen db.mjs, ohne HTTP.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addTodo, localDay, maybeRollover, openDb, readHistory, readState, setDone, setMeta } from './db.mjs'

const dir = await mkdtemp(join(tmpdir(), 'tagesplaner-rollover-'))
const db = openDb(join(dir, 'test.db'))

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}
const texts = (l) => l.map((t) => t.text + (t.done ? '*' : ''))

// --- Freitag: zwei Sachen fuer heute, eine im Backlog fuer morgen
const FREITAG = '2026-09-11'
const steuer = addTodo(db, 'today', 'Steuererklaerung')
const einkauf = addTodo(db, 'today', 'Einkaufen')
addTodo(db, 'tomorrow', 'Arzt anrufen')
setDone(db, einkauf.id, true)
db.prepare('UPDATE todos SET done_day = ? WHERE id = ?').run(FREITAG, einkauf.id)
setMeta(db, 'last_day', FREITAG)

check('Freitagabend: heute', texts(readState(db).today), ['Steuererklaerung', 'Einkaufen*'])
check('Freitagabend: morgen', texts(readState(db).tomorrow), ['Arzt anrufen'])

// --- Samstag und Sonntag: App nicht geoeffnet, kein Request, kein Rollover.
// Montag, erster Aufruf. Zwischen FREITAG und heute liegen mehrere Tage.
console.log(`\n  (letzte Oeffnung ${FREITAG}, naechster Aufruf ${localDay()} – mehrere Tage Pause)\n`)

check('Rollover findet statt', maybeRollover(db), true)
let state = readState(db)
check('offenes Todo steht noch in HEUTE', texts(state.today), ['Steuererklaerung', 'Arzt anrufen'])
check('morgen ist leer', state.tomorrow, [])
check('Erledigtes ist aus heute raus', texts(state.today).includes('Einkaufen*'), false)

const history = readHistory(db)
check('Historie: unter dem Tag des Abhakens', history.map((d) => d.day), [FREITAG])
check('Historie: das richtige Todo', history[0].todos.map((t) => t.text), ['Einkaufen'])

// --- Mehrere Tage in Folge: das offene Todo darf nicht nach "morgen" wandern
// und nicht mehrfach verschoben werden.
for (const tag of ['2026-09-14', '2026-09-15', '2026-09-16']) {
  setMeta(db, 'last_day', tag)
  maybeRollover(db)
}
state = readState(db)
check('nach drei weiteren Tagen: immer noch in heute', texts(state.today), [
  'Steuererklaerung',
  'Arzt anrufen',
])
check('nach drei weiteren Tagen: morgen leer', state.tomorrow, [])
check('kein Duplikat entstanden', state.today.length + state.tomorrow.length, 2)
check('zweiter Aufruf am selben Tag rollt nicht', maybeRollover(db), false)

// --- Am Montag abgehakt: landet unter dem Montag, nicht unter Freitag
setDone(db, steuer.id, true)
setMeta(db, 'last_day', '2026-09-17')
maybeRollover(db)
const days = readHistory(db).map((d) => d.day)
check('Historie hat jetzt zwei Tage', days.length, 2)
check('neuester Tag zuerst', days[0], localDay())

db.close()
await rm(dir, { recursive: true, force: true })
console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Rollover-Tests gruen')
process.exit(fails ? 1 : 0)
