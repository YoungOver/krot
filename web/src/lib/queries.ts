import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, del, patch, post } from './api'
import { useAuth } from './auth'
import type { ApiToken, Billing, Domain, Plan, Point, Region, Req, Session, Tunnel, User } from './types'

export const useTunnels = () => useQuery({ queryKey: ['tunnels'], queryFn: () => api<Tunnel[]>('/api/tunnels') })
export const useStats = (range: '24h' | '7d') => useQuery({ queryKey: ['stats', range], queryFn: () => api<Point[]>(`/api/stats?range=${range}`) })
export const useRequests = (tunnel: string | null, live: boolean) =>
  useQuery({
    queryKey: ['requests', tunnel],
    queryFn: () => api<Req[]>(`/api/requests${tunnel ? `?tunnel=${tunnel}` : ''}`),
    refetchInterval: live ? 2000 : false,
  })
export const useTokens = () => useQuery({ queryKey: ['tokens'], queryFn: () => api<ApiToken[]>('/api/tokens') })
export const useDomains = () => useQuery({ queryKey: ['domains'], queryFn: () => api<Domain[]>('/api/domains') })
export const useBilling = () => useQuery({ queryKey: ['billing'], queryFn: () => api<Billing>('/api/billing') })
export const useSessions = () => useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/api/sessions') })

export function useCreateTunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { proto: 'http' | 'tcp'; local_port: number; subdomain: string; region: Region }) => post<Tunnel>('/api/tunnels', b),
    onSuccess: (t) => qc.setQueryData<Tunnel[]>(['tunnels'], (xs = []) => [...xs, t]),
  })
}

// Optimistic toggle: the switch flips immediately and rolls back if the API refuses.
export function usePauseTunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) => patch<Tunnel>(`/api/tunnels/${id}`, { paused }),
    onMutate: async ({ id, paused }) => {
      await qc.cancelQueries({ queryKey: ['tunnels'] })
      const prev = qc.getQueryData<Tunnel[]>(['tunnels'])
      qc.setQueryData<Tunnel[]>(['tunnels'], (xs = []) => xs.map((t) => (t.id === id ? { ...t, status: paused ? 'paused' : 'online' } : t)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['tunnels'], ctx.prev),
  })
}

export function useDeleteTunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/api/tunnels/${id}`),
    onSuccess: (_r, id) => qc.setQueryData<Tunnel[]>(['tunnels'], (xs = []) => xs.filter((t) => t.id !== id)),
  })
}

export function useChangePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (plan: Plan) => post<Billing>('/api/billing/plan', { plan }),
    onSuccess: (b) => {
      qc.setQueryData(['billing'], b)
      const { user, token } = useAuth.getState()
      if (user && token) useAuth.getState().set(token, { ...user, plan: b.plan })
    },
  })
}

export function useUpdateMe() {
  return useMutation({
    mutationFn: (b: Partial<Pick<User, 'name' | 'twofa'>>) => patch<User>('/api/me', b),
    onSuccess: (u) => {
      const t = useAuth.getState().token
      if (t) useAuth.getState().set(t, u)
    },
  })
}
