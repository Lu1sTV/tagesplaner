import type { ListId, State, Todo } from './order'

export type HistoryDay = { day: string; todos: { id: string; text: string }[] }

/** Wird geworfen, wenn die Session weg ist – die App zeigt dann den Login. */
export class Unauthorized extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) throw new Unauthorized('Nicht angemeldet')
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error((detail as { error?: string }).error ?? `Fehler ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  login: (password: string) => call<{ ok: true }>('POST', '/api/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/logout'),
  state: () => call<State>('GET', '/api/state'),
  history: () => call<{ days: HistoryDay[] }>('GET', '/api/history').then((r) => r.days),
  add: (list: ListId, text: string) => call<Todo>('POST', '/api/todos', { list, text }),
  patch: (id: string, patch: { done?: boolean; text?: string }) =>
    call<{ ok: true }>('PATCH', `/api/todos/${id}`, patch),
  remove: (id: string) => call<{ ok: true }>('DELETE', `/api/todos/${id}`),
  order: (today: string[], tomorrow: string[]) =>
    call<{ ok: true }>('POST', '/api/order', { today, tomorrow }),
}
