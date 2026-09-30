import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useRequests, useStats, useTunnels } from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import { Skeleton, StatusDot } from '@/components/ui/kit'
import { PageHead } from './AppLayout'

const fmt = new Intl.NumberFormat('ru-RU')

export default function Overview() {
  const user = useAuth((s) => s.user)!
  const [range, setRange] = useState<'24h' | '7d'>('24h')
  const stats = useStats(range)
  const tunnels = useTunnels()
  const reqs = useRequests(null, true)
  const pts = stats.data ?? []
  const total = pts.reduce((s, p) => s + p.requests, 0)
  const errors = pts.reduce((s, p) => s + p.errors, 0)
  const p95 = pts.length ? Math.round(pts.reduce((s, p) => s + p.p95, 0) / pts.length) : 0
  const online = tunnels.data?.filter((t) => t.status === 'online').length ?? 0

  const kpis = [
    ['Запросов', fmt.format(total)],
    ['Ошибок', total ? `${((errors / total) * 100).toFixed(2)}%` : '0%'],
    ['Задержка p95', `${p95} мс`],
    ['Туннелей онлайн', `${online} из ${tunnels.data?.length ?? 0}`],
  ]

  return (
    <>
      <PageHead title={`Привет, ${user.name}`} sub="Что происходит с туннелями прямо сейчас" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-seam bg-seam lg:grid-cols-4">
        {kpis.map(([k, v], i) => (
          <motion.div key={k} className="bg-soil p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
            <p className="text-sm text-dust">{k}</p>
            {stats.isLoading ? <Skeleton className="mt-3 h-9 w-28" /> : <p className="display mt-2 text-3xl">{v}</p>}
          </motion.div>
        ))}
      </div>

      <section className="mt-8 rounded-3xl border border-seam p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Трафик</h2>
          <div className="flex rounded-full border border-seam p-1 text-sm">
            {(['24h', '7d'] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)} className="relative rounded-full px-3 py-1">
                {range === r && <motion.span layoutId="range" className="absolute inset-0 rounded-full bg-clay-2" />}
                <span className="relative">{r === '24h' ? 'Сутки' : 'Неделя'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          {stats.isLoading ? (
            <Skeleton className="size-full" />
          ) : (
            <ResponsiveContainer>
              <AreaChart data={pts} margin={{ left: -18, right: 6 }}>
                <defs>
                  <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ffb347" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#ffb347" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#3a2a20" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleString('ru-RU', range === '24h' ? { hour: '2-digit' } : { day: 'numeric', month: 'short' })} stroke="#8f8174" fontSize={12} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis stroke="#8f8174" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => fmt.format(v)} />
                <Tooltip
                  contentStyle={{ background: '#241913', border: '1px solid #3a2a20', borderRadius: 12 }}
                  labelFormatter={(t) => new Date(String(t)).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                  formatter={(v, n) => [fmt.format(Number(v)), n === 'requests' ? 'Запросов' : 'Ошибок']}
                />
                <Area type="monotone" dataKey="requests" stroke="#ffb347" strokeWidth={2} fill="url(#g)" animationDuration={700} />
                <Area type="monotone" dataKey="errors" stroke="#ff6b5a" strokeWidth={1.5} fill="transparent" animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="rounded-3xl border border-seam p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Туннели</h2>
            <Link to="/app/tunnels" className="text-sm text-lamp hover:underline">Все туннели</Link>
          </div>
          <ul className="space-y-3">
            {tunnels.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-14" />)}
            {tunnels.data?.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-clay/50 px-4 py-3">
                <StatusDot status={t.status} />
                <span className="flex-1 truncate font-mono text-sm">{t.url.replace('https://', '')}</span>
                <span className="text-sm text-dust">:{t.local_port}</span>
              </li>
            ))}
            {tunnels.data?.length === 0 && (
              <li className="rounded-2xl border border-dashed border-seam p-6 text-dust">
                Туннелей пока нет. <Link to="/app/tunnels" className="text-lamp">Создайте первый</Link>, чтобы получить адрес.
              </li>
            )}
          </ul>
        </section>
        <section className="rounded-3xl border border-seam p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <StatusDot status="online" /> Последние запросы
            </h2>
            <Link to="/app/inspector" className="text-sm text-lamp hover:underline">Открыть инспектор</Link>
          </div>
          <ul className="divide-y divide-seam/70 font-mono text-[13px]">
            {reqs.data?.slice(0, 7).map((r) => (
              <motion.li key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 py-2.5">
                <span className="w-12 text-dust">{r.method}</span>
                <span className="flex-1 truncate">{r.path}</span>
                <span className={r.status >= 400 ? 'text-alarm' : 'text-signal'}>{r.status}</span>
              </motion.li>
            ))}
            {reqs.data?.length === 0 && <li className="py-6 font-sans text-dust">Запросов пока нет: включите туннель и откройте его адрес.</li>}
          </ul>
        </section>
      </div>
    </>
  )
}
