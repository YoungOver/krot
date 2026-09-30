import type { ApiToken, Billing, Domain, Plan, Point, Region, Req, Session, Tunnel, User } from '@/lib/types'

// In-browser stand-in for the Go API, used by the static demo build.
// State survives reloads through localStorage so the demo feels like a real account.

type Account = User & { password: string }
type State = {
  accounts: Account[]
  pending: Record<string, { email: string; name: string; password: string; code: string }>
  sessions: Record<string, string> // refresh token -> user id
  tunnels: Tunnel[]
  tokens: (ApiToken & { user_id: string })[]
  domains: (Domain & { user_id: string })[]
  plans: Record<string, Plan>
}

const KEY = 'krot-demo-v1'

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* storage unavailable: fall through to a fresh state */
  }
  return { accounts: [], pending: {}, sessions: {}, tunnels: [], tokens: [], domains: [], plans: {} }
}

export const db = load()
export const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* ignore quota and privacy-mode errors */
  }
}

export const id = (p: string) => p + '_' + Math.random().toString(36).slice(2, 10)
export const now = () => new Date().toISOString()

export function publicUser(a: Account): User {
  const { password: _p, ...u } = a
  return { ...u, plan: db.plans[a.id] ?? a.plan }
}

// A tiny deterministic PRNG so generated traffic is stable between polls.
function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)

const routes = [
  ['GET', '/api/products?page=2', 200],
  ['POST', '/api/orders', 201],
  ['GET', '/api/orders/8817', 200],
  ['POST', '/webhooks/yookassa', 200],
  ['POST', '/webhooks/telegram', 200],
  ['GET', '/static/app.9f3c.js', 200],
  ['GET', '/api/me', 401],
  ['PATCH', '/api/cart', 200],
  ['POST', '/api/login', 422],
  ['GET', '/health', 200],
  ['POST', '/api/upload', 500],
] as const

const ips = ['95.161.22.8', '188.170.84.3', '31.173.80.41', '46.39.228.17', '176.59.40.12']

// Requests for a tunnel in the second `sec` (unix seconds): 0..3 per second.
function requestsAt(t: Tunnel, sec: number): Req[] {
  const rnd = mulberry(hash(t.id) ^ sec)
  const n = Math.floor(rnd() * 3.4)
  const out: Req[] = []
  for (let i = 0; i < n; i++) {
    const [method, path, status] = routes[Math.floor(rnd() * routes.length)]
    const dur = Math.round(8 + rnd() ** 3 * 420)
    const at = new Date(sec * 1000 + Math.floor(rnd() * 1000)).toISOString()
    const json = status >= 400 ? `{"error":"${status === 401 ? 'unauthorized' : status === 422 ? 'invalid email' : 'internal'}"}` : '{"ok":true}'
    out.push({
      id: `${t.id}-${sec}-${i}`,
      tunnel_id: t.id,
      method,
      path,
      status,
      duration_ms: dur,
      size: Math.round(200 + rnd() * 18000),
      ip: ips[Math.floor(rnd() * ips.length)],
      at,
      req_headers: {
        host: new URL(t.url).host,
        'user-agent': rnd() > 0.5 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1)' : 'python-requests/2.32',
        'x-forwarded-for': ips[Math.floor(rnd() * ips.length)],
        'content-type': 'application/json',
      },
      res_headers: { 'content-type': 'application/json', 'x-krot-region': t.region, 'x-request-id': `${sec}${i}` },
      req_body: method === 'GET' ? '' : '{"email":"anna@example.ru","items":[{"sku":"TEA-11","qty":2}]}',
      res_body: json,
    })
  }
  return out
}

export function recentRequests(t: Tunnel, limit = 60): Req[] {
  if (t.status !== 'online') return []
  const nowSec = Math.floor(Date.now() / 1000)
  const out: Req[] = []
  for (let s = nowSec; out.length < limit && s > nowSec - 3600; s--) out.push(...requestsAt(t, s).reverse())
  return out.slice(0, limit)
}

export function series(tunnels: Tunnel[], hours: number): Point[] {
  const pts: Point[] = []
  const end = Math.floor(Date.now() / 3_600_000)
  for (let h = end - hours + 1; h <= end; h++) {
    const rnd = mulberry(h * 7919)
    const load = tunnels.filter((t) => t.status !== 'offline').length || 0.3
    const day = Math.sin(((h % 24) / 24) * Math.PI * 2 - 1.6) * 0.5 + 0.8
    const requests = Math.round(load * day * (900 + rnd() * 700))
    pts.push({
      t: new Date(h * 3_600_000).toISOString(),
      requests,
      errors: Math.round(requests * (0.004 + rnd() * 0.02)),
      p95: Math.round(60 + rnd() * 90 + (rnd() > 0.92 ? 250 : 0)),
    })
  }
  return pts
}

export function newTunnel(userId: string, proto: 'http' | 'tcp', port: number, subdomain: string, region: Region): Tunnel {
  const t: Tunnel = {
    id: id('tn'),
    proto,
    local_port: port,
    subdomain,
    url: proto === 'http' ? `https://${subdomain}.krot.dev` : `tcp://${region}.krot.dev:${20000 + Math.floor(Math.random() * 9999)}`,
    region,
    status: 'online',
    requests_24h: 0,
    created_at: now(),
  }
  ;(t as Tunnel & { user_id: string }).user_id = userId
  return t
}

export function billing(userId: string, tunnels: number): Billing {
  const plan = db.plans[userId] ?? 'free'
  const limits = { free: [1, 20_000], pro: [10, 2_000_000], team: [50, 20_000_000] }[plan]
  return {
    plan,
    renews_at: new Date(Date.now() + 18 * 864e5).toISOString(),
    usage: { tunnels, tunnels_limit: limits[0], requests: 12_480 * Math.max(tunnels, 1), requests_limit: limits[1] },
    invoices:
      plan === 'free'
        ? []
        : [
            { id: 'inv_2609', period: 'Сентябрь 2026', amount: plan === 'pro' ? 690 : 2490, status: 'paid' },
            { id: 'inv_2608', period: 'Август 2026', amount: plan === 'pro' ? 690 : 2490, status: 'paid' },
          ],
  }
}

export const sessionsFor = (): Session[] => [
  { id: 'ses_cur', agent: 'Chrome, Windows', ip: '95.161.22.8', city: 'Санкт-Петербург', last_seen: now(), current: true },
  { id: 'ses_iph', agent: 'Safari, iPhone', ip: '176.59.40.12', city: 'Санкт-Петербург', last_seen: new Date(Date.now() - 3 * 36e5).toISOString(), current: false },
  { id: 'ses_cli', agent: 'krot-cli 1.8.2, macOS', ip: '188.170.84.3', city: 'Москва', last_seen: new Date(Date.now() - 26 * 36e5).toISOString(), current: false },
]
