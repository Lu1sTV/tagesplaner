// Tests fuer reorder() aus order.ts – laufen mit: node src/place.test.mjs
import { reorder } from './order.ts'

const place = (s, from, id, to, beforeId) => reorder(s, from, id, to, beforeId)

const mk = (ids) => ids.map((id) => ({ id }))
const ids = (l) => l.map((t) => t.id).join('')
let fails = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${got}${ok ? '' : ` (erwartet ${want})`}`)
}

let s = { today: mk(['A', 'B', 'C', 'D']), tomorrow: mk(['X', 'Y']), day: '2026-09-18' }

check('A ans Ende (beforeId=null)', ids(place(s, 'today', 'A', 'today', null).today), 'BCDA')
check('A vor C', ids(place(s, 'today', 'A', 'today', 'C').today), 'BACD')
check('D vor A (nach oben)', ids(place(s, 'today', 'D', 'today', 'A').today), 'DABC')
check('C vor B', ids(place(s, 'today', 'C', 'today', 'B').today), 'ACBD')

const noop = place(s, 'today', 'A', 'today', 'B')
check('A vor B = no-op, gleiche Referenz', noop === s ? 'same' : 'neu', 'same')
const noop2 = place(s, 'today', 'D', 'today', null)
check('D ans Ende = no-op, gleiche Referenz', noop2 === s ? 'same' : 'neu', 'same')

const cross = place(s, 'today', 'B', 'tomorrow', 'Y')
check('B nach morgen vor Y', ids(cross.tomorrow), 'XBY')
check('B aus heute entfernt', ids(cross.today), 'ACD')
const crossEnd = place(s, 'tomorrow', 'X', 'today', null)
check('X nach heute ans Ende', ids(crossEnd.today), 'ABCDX')
check('morgen danach', ids(crossEnd.tomorrow), 'Y')

// Mehrere Schritte hintereinander, wie beim Ziehen ueber mehrere Zeilen.
let dragged = s
for (const before of ['C', 'D', null]) dragged = place(dragged, 'today', 'A', 'today', before)
check('A schrittweise ganz nach unten', ids(dragged.today), 'BCDA')

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests gruen')
process.exit(fails ? 1 : 0)
