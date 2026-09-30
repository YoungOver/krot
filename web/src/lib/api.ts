import { useAuth } from './auth'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

const base = import.meta.env.VITE_API_URL ?? ''

async function raw(path: string, init: RequestInit = {}, token?: string | null) {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(base + path, { ...init, headers, credentials: 'include' })
}

let refreshing: Promise<boolean> | null = null

// One refresh in flight at a time: parallel 401s wait for the same rotation.
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await raw('/api/auth/refresh', { method: 'POST' })
      if (!res.ok) {
        useAuth.getState().clear()
        return false
      }
      const data = await res.json()
      useAuth.getState().set(data.access_token, data.user)
      return true
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init, useAuth.getState().token)
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) res = await raw(path, init, useAuth.getState().token)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'unknown', body.message ?? 'Запрос не выполнен')
  return body as T
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })
export const patch = <T>(path: string, data: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) })
export const del = (path: string) => api<void>(path, { method: 'DELETE' })
