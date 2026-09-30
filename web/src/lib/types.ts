export type Plan = 'free' | 'pro' | 'team'

export type User = {
  id: string
  email: string
  name: string
  plan: Plan
  twofa: boolean
  created_at: string
}

export type Region = 'msk' | 'spb' | 'ams' | 'fra'

export type Tunnel = {
  id: string
  proto: 'http' | 'tcp'
  local_port: number
  subdomain: string
  url: string
  region: Region
  status: 'online' | 'paused' | 'offline'
  requests_24h: number
  created_at: string
}

export type Req = {
  id: string
  tunnel_id: string
  method: string
  path: string
  status: number
  duration_ms: number
  size: number
  ip: string
  at: string
  req_headers: Record<string, string>
  res_headers: Record<string, string>
  req_body: string
  res_body: string
}

export type Point = { t: string; requests: number; errors: number; p95: number }

export type ApiToken = { id: string; name: string; prefix: string; last_used: string | null; created_at: string; secret?: string }

export type Domain = { id: string; host: string; status: 'pending' | 'active'; cname: string; tunnel_id: string | null }

export type Invoice = { id: string; period: string; amount: number; status: 'paid' | 'due' }

export type Billing = {
  plan: Plan
  renews_at: string
  usage: { tunnels: number; tunnels_limit: number; requests: number; requests_limit: number }
  invoices: Invoice[]
}

export type Session = { id: string; agent: string; ip: string; city: string; last_seen: string; current: boolean }
