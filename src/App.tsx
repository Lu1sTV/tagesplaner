import { useCallback, useEffect, useRef, useState } from 'react'
import { api, Unauthorized, type HistoryDay } from './api'
import { reorder, type ListId, type State, type Todo } from './order'

const LISTS: { id: ListId; title: string; hint: string }[] = [
  { id: 'today', title: 'Heute', hint: 'Was heute passieren soll' },
  { id: 'tomorrow', title: 'Morgen', hint: 'Backlog für morgen' },
]

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'plan' | 'history'>('plan')

  const load = useCallback(async () => {
    try {
      setState(await api.state())
      setAuthed(true)
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) setAuthed(false)
      else setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Tageswechsel passiert auf dem Server. Der Client holt sich den Stand neu,
  // wenn der Tab wieder in den Fokus kommt – so stimmt die Liste am Morgen.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && authed) load()
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [authed, load])

  /** Optimistisch anwenden, dann den Request. Schlaegt er fehl, vom Server neu laden. */
  const mutate = async (next: State, request: Promise<unknown>) => {
    setState(next)
    try {
      await request
    } catch (err) {
      if (err instanceof Unauthorized) return setAuthed(false)
      setError((err as Error).message)
      load()
    }
  }

  // Fehler zuerst: sonst haengt die App im Ladezustand, wenn der Server nicht
  // antwortet (dann kommt kein 401, und `authed` bleibt unbekannt).
  if (error && !state) return <Offline message={error} onRetry={load} />
  if (authed === null || (authed && !state)) return <main className="center">Lade …</main>
  if (!authed) return <Login onDone={load} />
  if (!state) return <main className="center">Lade …</main>

  const add = async (list: ListId, text: string) => {
    try {
      const todo = await api.add(list, text)
      setState((s) => (s ? { ...s, [list]: [...s[list], todo] } : s))
    } catch (err) {
      if (err instanceof Unauthorized) return setAuthed(false)
      setError((err as Error).message)
    }
  }

  const toggle = (list: ListId, id: string) => {
    const todo = state[list].find((t) => t.id === id)
    if (!todo) return
    const next = {
      ...state,
      [list]: state[list].map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }
    mutate(next, api.patch(id, { done: !todo.done }))
  }

  const rename = (list: ListId, id: string, text: string) => {
    const next = {
      ...state,
      [list]: state[list].map((t) => (t.id === id ? { ...t, text } : t)),
    }
    mutate(next, api.patch(id, { text }))
  }

  const remove = (list: ListId, id: string) =>
    mutate({ ...state, [list]: state[list].filter((t) => t.id !== id) }, api.remove(id))

  const clearDone = (list: ListId) => {
    const done = state[list].filter((t) => t.done)
    const next = { ...state, [list]: state[list].filter((t) => !t.done) }
    mutate(next, Promise.all(done.map((t) => api.remove(t.id))))
  }

  const saveOrder = (s: State) =>
    mutate(
      s,
      api.order(
        s.today.map((t) => t.id),
        s.tomorrow.map((t) => t.id),
      ),
    )

  const move = (from: ListId, id: string) => {
    const to: ListId = from === 'today' ? 'tomorrow' : 'today'
    saveOrder(reorder(state, from, id, to, null))
  }

  return (
    <main>
      <header>
        <div>
          <h1>Tagesplaner</h1>
          <p>{formatDay(state.day)}</p>
        </div>
        <nav>
          <button className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')}>
            Plan
          </button>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            Rückblick
          </button>
          <button
            onClick={async () => {
              await api.logout()
              setAuthed(false)
              setState(null)
            }}
          >
            Abmelden
          </button>
        </nav>
      </header>

      {error && (
        <p className="error" role="alert">
          {error} <button onClick={load}>Neu laden</button>
        </p>
      )}

      {view === 'plan' ? (
        <Plan
          state={state}
          setState={setState}
          onSaveOrder={saveOrder}
          onAdd={add}
          onToggle={toggle}
          onRename={rename}
          onRemove={remove}
          onMove={move}
          onClearDone={clearDone}
        />
      ) : (
        <History onError={setError} />
      )}
    </main>
  )
}

function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function Offline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="center">
      <div className="login">
        <h1>Kein Server</h1>
        <p className="error">{message}</p>
        <p className="empty">
          Der Tagesplaner-Server antwortet nicht. Im Dev-Modus muss er mit{' '}
          <code>pnpm dev</code> mitgestartet werden.
        </p>
        <button type="button" onClick={onRetry}>
          Nochmal versuchen
        </button>
      </div>
    </main>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.login(password)
      onDone()
    } catch (err) {
      setError(err instanceof Unauthorized ? 'Falsches Passwort' : (err as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center">
      <form className="login" onSubmit={submit}>
        <h1>Tagesplaner</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          aria-label="Passwort"
          autoFocus
        />
        <button type="submit" disabled={busy || !password}>
          {busy ? '…' : 'Anmelden'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  )
}

type PlanProps = {
  state: State
  setState: React.Dispatch<React.SetStateAction<State | null>>
  onSaveOrder: (s: State) => void
  onAdd: (list: ListId, text: string) => void
  onToggle: (list: ListId, id: string) => void
  onRename: (list: ListId, id: string, text: string) => void
  onRemove: (list: ListId, id: string) => void
  onMove: (list: ListId, id: string) => void
  onClearDone: (list: ListId) => void
}

function Plan({ state, setState, onSaveOrder, ...handlers }: PlanProps) {
  // Waehrend des Ziehens wird nur lokal umsortiert; gespeichert wird beim Loslassen.
  const drag = useRef<{ list: ListId; id: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const onDragStart = (list: ListId, id: string) => {
    drag.current = { list, id }
    setDraggingId(id)
  }

  const onDragEnd = () => {
    // `state` ist hier der Stand nach dem letzten Umsortieren – der Render davor
    // ist durch, weil dragend ein eigenes Event ist.
    if (drag.current) onSaveOrder(state)
    drag.current = null
    setDraggingId(null)
  }

  const onDragOverTodo = (list: ListId, beforeId: string | null) => {
    const src = drag.current
    if (!src) return
    setState((s) => (s ? reorder(s, src.list, src.id, list, beforeId) : s))
    drag.current = { list, id: src.id }
  }

  return (
    <>
      <div className="lists">
        {LISTS.map(({ id, title, hint }) => (
          <List
            key={id}
            id={id}
            title={title}
            hint={hint}
            todos={state[id]}
            draggingId={draggingId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOverTodo={onDragOverTodo}
            {...handlers}
          />
        ))}
      </div>
      <p className="tip">
        Zum Sortieren ziehen – auch von einer Liste in die andere. Doppelklick bearbeitet den Text.
      </p>
    </>
  )
}

type ListProps = {
  id: ListId
  title: string
  hint: string
  todos: Todo[]
  draggingId: string | null
  onAdd: (list: ListId, text: string) => void
  onToggle: (list: ListId, id: string) => void
  onRename: (list: ListId, id: string, text: string) => void
  onRemove: (list: ListId, id: string) => void
  onMove: (list: ListId, id: string) => void
  onClearDone: (list: ListId) => void
  onDragStart: (list: ListId, id: string) => void
  onDragEnd: () => void
  onDragOverTodo: (list: ListId, beforeId: string | null) => void
}

function List({
  id,
  title,
  hint,
  todos,
  draggingId,
  onAdd,
  onToggle,
  onRename,
  onRemove,
  onMove,
  onClearDone,
  onDragStart,
  onDragEnd,
  onDragOverTodo,
}: ListProps) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = todos.filter((t) => !t.done).length
  const doneCount = todos.length - open

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    onAdd(id, value)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <section
      className="list"
      onDragOver={(e) => {
        e.preventDefault()
        onDragOverTodo(id, null) // leerer Bereich = ans Ende dieser Liste
      }}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="list-head">
        <h2>{title}</h2>
        <span className="count">{open} offen</span>
      </div>

      <form onSubmit={submit}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={hint}
          aria-label={`Todo für ${title}`}
        />
        <button type="submit" aria-label="Hinzufügen">+</button>
      </form>

      <ul>
        {todos.map((todo, i) => (
          <li
            key={todo.id}
            draggable={editing !== todo.id}
            className={[todo.done ? 'done' : '', draggingId === todo.id ? 'dragging' : '']
              .filter(Boolean)
              .join(' ')}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              onDragStart(id, todo.id)
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const box = e.currentTarget.getBoundingClientRect()
              const below = e.clientY > box.top + box.height / 2
              onDragOverTodo(id, below ? (todos[i + 1]?.id ?? null) : todo.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <span className="grip" aria-hidden="true">⠿</span>
            {editing === todo.id ? (
              <input
                className="edit"
                defaultValue={todo.text}
                autoFocus
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  if (value && value !== todo.text) onRename(id, todo.id, value)
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <label>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => onToggle(id, todo.id)}
                />
                <span onDoubleClick={() => setEditing(todo.id)}>{todo.text}</span>
              </label>
            )}
            <div className="actions">
              <button
                onClick={() => onMove(id, todo.id)}
                title={id === 'today' ? 'Auf morgen schieben' : 'Nach heute holen'}
              >
                {id === 'today' ? '→' : '←'}
              </button>
              <button onClick={() => onRemove(id, todo.id)} title="Löschen">
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      {todos.length === 0 && <p className="empty">Nichts geplant.</p>}
      {doneCount > 0 && (
        <button className="clear" onClick={() => onClearDone(id)}>
          {doneCount} erledigte endgültig löschen
        </button>
      )}
    </section>
  )
}

function History({ onError }: { onError: (msg: string) => void }) {
  const [days, setDays] = useState<HistoryDay[] | null>(null)

  useEffect(() => {
    api
      .history()
      .then(setDays)
      .catch((err) => onError((err as Error).message))
  }, [onError])

  if (!days) return <p className="empty">Lade …</p>
  if (days.length === 0) {
    return (
      <p className="empty">
        Noch kein Rückblick. Erledigte Todos wandern beim Tageswechsel hierher.
      </p>
    )
  }

  return (
    <div className="history">
      {days.map(({ day, todos }) => (
        <section key={day}>
          <div className="list-head">
            <h2>{formatDay(day)}</h2>
            <span className="count">{todos.length} erledigt</span>
          </div>
          <ul>
            {todos.map((t) => (
              <li key={t.id}>
                <span className="tick" aria-hidden="true">✓</span>
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
