import { create } from 'zustand'
import type { User } from './types'

// The access token lives only in memory; the refresh token is an httpOnly cookie
// the browser sends to /api/auth/refresh. A page reload re-derives the session.
type AuthState = {
  token: string | null
  user: User | null
  ready: boolean
  set: (token: string, user: User) => void
  clear: () => void
  markReady: () => void
}

export const useAuth = create<AuthState>((set) => ({
  token: null,
  user: null,
  ready: false,
  set: (token, user) => set({ token, user }),
  clear: () => set({ token: null, user: null }),
  markReady: () => set({ ready: true }),
}))
