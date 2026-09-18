export type ListId = 'today' | 'tomorrow'

export type Todo = {
  id: string
  text: string
  done: boolean
}

export type State = {
  today: Todo[]
  tomorrow: Todo[]
  /** Tag, fuer den der Server diesen Stand geliefert hat (YYYY-MM-DD). */
  day: string
}

/**
 * Verschiebt ein Todo an eine Position: vor `beforeId`, oder ans Ende wenn null.
 * Gibt `state` unveraendert zurueck, wenn es dort schon liegt – dragover feuert
 * im Millisekundentakt, und nur eine echte Aenderung darf einen Render kosten.
 */
export function reorder(
  state: State,
  from: ListId,
  id: string,
  to: ListId,
  beforeId: string | null,
): State {
  const index = state[from].findIndex((t) => t.id === id)
  if (index < 0 || id === beforeId) return state
  if (from === to && (state[from][index + 1]?.id ?? null) === beforeId) return state

  const todo = state[from][index]
  const rest = state[from].filter((t) => t.id !== id)
  // Zielindex in der Liste *ohne* das gezogene Todo suchen – sonst rutscht es
  // beim Ziehen nach unten eine Position zu weit.
  const target = [...(from === to ? rest : state[to])]
  const found = beforeId ? target.findIndex((t) => t.id === beforeId) : -1
  target.splice(found < 0 ? target.length : found, 0, todo)

  return from === to ? { ...state, [to]: target } : { ...state, [from]: rest, [to]: target }
}
