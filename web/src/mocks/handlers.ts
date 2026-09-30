import { delay, http, HttpResponse, type PathParams } from 'msw'
import type { Region, Tunnel } from '@/lib/types'
import { billing, db, id, newTunnel, now, publicUser, recentRequests, save, series, sessionsFor } from './db'

// The demo has no cookies across origins, so the "httpOnly refresh cookie" of the
// real API is represented by one key in localStorage.
const RT = 'krot-demo-rt'
const tokens = new Map<string, string>() // access token -> user id

function issue(userId: string) {
  const access = id('at')
  tokens.set(access, userId)
  const refresh = id('rt')
  db.sessions[refresh] = userId
  localStorage.setItem(RT, refresh)
  save()
  const acc = db.accounts.find((a) => a.id === userId)!
  return { access_token: access, user: publicUser(acc) }
}

const fail = (status: number, code: string, message: string) => HttpResponse.json({ code, message }, { status })

function who(req: Request) {
  const tok = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const uid = tokens.get(tok)
  return uid ? db.accounts.find((a) => a.id === uid) ?? null : null
}

type Owned<T> = T & { user_id: string }
const mine = (uid: string) => (db.tunnels as Owned<Tunnel>[]).filter((t) => t.user_id === uid)

const guard =
  (fn: (uid: string, req: Request, params: Record<string, string>) => Promise<Response> | Response) =>
  async ({ request, params }: { request: Request; params: PathParams }) => {
    await delay(180 + Math.random() * 220)
    const u = who(request)
    if (!u) return fail(401, 'unauthorized', 'Сессия истекла')
    return fn(u.id, request, params as Record<string, string>)
  }

const tr: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' }
const slug = (s: string) => [...s.toLowerCase()].map((c) => tr[c] ?? c).join('').replace(/[^a-z0-9]/g, '').slice(0, 12)

const reserved = new Set(['www', 'api', 'app', 'admin', 'mail', 'krot'])

export const handlers = [
  http.post('/api/auth/register', async ({ request }) => {
    await delay(500)
    const { email, password, name } = (await request.json()) as Record<string, string>
    if (!/^\S+@\S+\.\S+$/.test(email ?? '')) return fail(422, 'email', 'Проверьте адрес почты')
    if ((password ?? '').length < 8) return fail(422, 'password', 'Пароль должен быть не короче 8 символов')
    if (db.accounts.some((a) => a.email === email.toLowerCase())) return fail(409, 'exists', 'Аккаунт с этой почтой уже есть, войдите')
    const pid = id('pnd')
    db.pending[pid] = { email: email.toLowerCase(), name: name || email.split('@')[0], password, code: '424242' }
    save()
    return HttpResponse.json({ pending_id: pid, email: email.toLowerCase() })
  }),

  http.post('/api/auth/verify', async ({ request }) => {
    await delay(450)
    const { pending_id, code } = (await request.json()) as Record<string, string>
    const p = db.pending[pending_id]
    if (!p) return fail(410, 'expired', 'Код устарел, зарегистрируйтесь заново')
    if (code !== p.code) return fail(422, 'code', 'Неверный код. В демо код 424242')
    const acc = { id: id('usr'), email: p.email, name: p.name, password: p.password, plan: 'free' as const, twofa: false, created_at: now() }
    db.accounts.push(acc)
    delete db.pending[pending_id]
    const t = newTunnel(acc.id, 'http', 3000, (slug(acc.name) || 'demo') + '-' + Math.floor(100 + Math.random() * 900), 'spb')
    db.tunnels.push(t)
    return HttpResponse.json(issue(acc.id))
  }),

  http.post('/api/auth/login', async ({ request }) => {
    await delay(500)
    const { email, password } = (await request.json()) as Record<string, string>
    const acc = db.accounts.find((a) => a.email === (email ?? '').toLowerCase())
    if (!acc || acc.password !== password) return fail(401, 'credentials', 'Неверная почта или пароль')
    return HttpResponse.json(issue(acc.id))
  }),

  http.post('/api/auth/refresh', async () => {
    await delay(120)
    const rt = localStorage.getItem(RT)
    const uid = rt ? db.sessions[rt] : undefined
    if (!rt || !uid) return fail(401, 'no_session', 'Нет активной сессии')
    delete db.sessions[rt] // rotation: a refresh token works exactly once
    return HttpResponse.json(issue(uid))
  }),

  http.post('/api/auth/logout', async () => {
    const rt = localStorage.getItem(RT)
    if (rt) delete db.sessions[rt]
    localStorage.removeItem(RT)
    save()
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('/api/tunnels', guard((uid) => HttpResponse.json(mine(uid).map((t) => ({ ...t, requests_24h: series([t], 24).reduce((s, p) => s + p.requests, 0) }))))),

  http.post(
    '/api/tunnels',
    guard(async (uid, req) => {
      const { proto, local_port, subdomain, region } = (await req.json()) as { proto: 'http' | 'tcp'; local_port: number; subdomain: string; region: Region }
      const plan = db.plans[uid] ?? 'free'
      const limit = { free: 1, pro: 10, team: 50 }[plan]
      if (mine(uid).length >= limit) return fail(402, 'limit', `На тарифе ${plan === 'free' ? 'Старт' : plan} доступно туннелей: ${limit}. Смените тариф в разделе «Оплата»`)
      if (!/^[a-z0-9-]{3,32}$/.test(subdomain)) return fail(422, 'subdomain', 'Поддомен: латиница, цифры и дефис, от 3 до 32 символов')
      if (reserved.has(subdomain) || db.tunnels.some((t) => t.subdomain === subdomain)) return fail(409, 'taken', `Адрес ${subdomain}.krot.dev уже занят`)
      if (!(local_port > 0 && local_port < 65536)) return fail(422, 'port', 'Порт от 1 до 65535')
      const t = newTunnel(uid, proto, local_port, subdomain, region)
      db.tunnels.push(t)
      save()
      return HttpResponse.json(t, { status: 201 })
    }),
  ),

  http.patch(
    '/api/tunnels/:id',
    guard(async (uid, req, { id: tid }) => {
      const t = mine(uid).find((x) => x.id === tid)
      if (!t) return fail(404, 'not_found', 'Туннель не найден')
      const { paused } = (await req.json()) as { paused: boolean }
      t.status = paused ? 'paused' : 'online'
      save()
      return HttpResponse.json(t)
    }),
  ),

  http.delete(
    '/api/tunnels/:id',
    guard((uid, _r, { id: tid }) => {
      db.tunnels = db.tunnels.filter((t) => !((t as Owned<Tunnel>).user_id === uid && t.id === tid))
      save()
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get(
    '/api/requests',
    guard((uid, req) => {
      const u = new URL(req.url)
      const tid = u.searchParams.get('tunnel')
      const ts = mine(uid).filter((t) => !tid || t.id === tid)
      const all = ts.flatMap((t) => recentRequests(t, 80)).sort((a, b) => b.at.localeCompare(a.at))
      return HttpResponse.json(all.slice(0, 80))
    }),
  ),

  http.post(
    '/api/requests/:id/replay',
    guard(async () => {
      await delay(400)
      return HttpResponse.json({ status: 200, duration_ms: 42 + Math.round(Math.random() * 60) })
    }),
  ),

  http.get(
    '/api/stats',
    guard((uid, req) => {
      const hours = new URL(req.url).searchParams.get('range') === '7d' ? 168 : 24
      return HttpResponse.json(series(mine(uid), hours))
    }),
  ),

  http.get('/api/tokens', guard((uid) => HttpResponse.json(db.tokens.filter((t) => t.user_id === uid).map(({ secret: _s, ...t }) => t)))),
  http.post(
    '/api/tokens',
    guard(async (uid, req) => {
      const { name } = (await req.json()) as { name: string }
      if (!name?.trim()) return fail(422, 'name', 'Назовите токен, например «ноутбук» или «CI»')
      const secret = 'krt_' + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('')
      const tok = { id: id('tok'), user_id: uid, name: name.trim(), prefix: secret.slice(0, 10), last_used: null, created_at: now() }
      db.tokens.push(tok)
      save()
      return HttpResponse.json({ ...tok, secret }, { status: 201 })
    }),
  ),
  http.delete(
    '/api/tokens/:id',
    guard((uid, _r, { id: tid }) => {
      db.tokens = db.tokens.filter((t) => !(t.user_id === uid && t.id === tid))
      save()
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get('/api/domains', guard((uid) => HttpResponse.json(db.domains.filter((d) => d.user_id === uid)))),
  http.post(
    '/api/domains',
    guard(async (uid, req) => {
      const { host } = (await req.json()) as { host: string }
      if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host ?? '')) return fail(422, 'host', 'Введите домен целиком, например api.shop.ru')
      const d = { id: id('dom'), user_id: uid, host, status: 'pending' as const, cname: `${host.split('.')[0]}.cname.krot.dev`, tunnel_id: null }
      db.domains.push(d)
      save()
      return HttpResponse.json(d, { status: 201 })
    }),
  ),
  http.post(
    '/api/domains/:id/check',
    guard(async (uid, _r, { id: did }) => {
      await delay(900)
      const d = db.domains.find((x) => x.user_id === uid && x.id === did)
      if (!d) return fail(404, 'not_found', 'Домен не найден')
      d.status = 'active'
      save()
      return HttpResponse.json(d)
    }),
  ),

  http.get('/api/billing', guard((uid) => HttpResponse.json(billing(uid, mine(uid).length)))),
  http.post(
    '/api/billing/plan',
    guard(async (uid, req) => {
      await delay(700)
      const { plan } = (await req.json()) as { plan: 'free' | 'pro' | 'team' }
      db.plans[uid] = plan
      save()
      return HttpResponse.json(billing(uid, mine(uid).length))
    }),
  ),

  http.get('/api/sessions', guard(() => HttpResponse.json(sessionsFor()))),
  http.delete('/api/sessions/:id', guard(() => new HttpResponse(null, { status: 204 }))),

  http.patch(
    '/api/me',
    guard(async (uid, req) => {
      const acc = db.accounts.find((a) => a.id === uid)!
      const body = (await req.json()) as { name?: string; twofa?: boolean }
      if (body.name !== undefined) acc.name = body.name.trim() || acc.name
      if (body.twofa !== undefined) acc.twofa = body.twofa
      save()
      return HttpResponse.json(publicUser(acc))
    }),
  ),
]
