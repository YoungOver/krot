import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { IconPlayerPause, IconPlayerPlay, IconX } from '@tabler/icons-react'
import { post } from '@/lib/api'
import { useRequests, useTunnels } from '@/lib/queries'
import type { Req } from '@/lib/types'
import { Button, Skeleton } from '@/components/ui/kit'
import { toast } from '@/components/ui/Toast'
import { PageHead } from './AppLayout'

const methodTone: Record<string, string> = { GET: 'text-signal', POST: 'text-lamp', PATCH: 'text-[#c9a7ff]', DELETE: 'text-alarm' }

function Detail({ r, onClose }: { r: Req; onClose: () => void }) {
  const [tab, setTab] = useState<'req' | 'res'>('req')
  const [busy, setBusy] = useState(false)
  const headers = tab === 'req' ? r.req_headers : r.res_headers
  const body = tab === 'req' ? r.req_body : r.res_body
  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-seam bg-clay shadow-2xl"
      aria-label="Запрос"
    >
      <div className="flex items-start justify-between gap-4 border-b border-seam p-6">
        <div className="min-w-0">
          <p className="font-mono text-sm">
            <span className={methodTone[r.method] ?? 'text-bone'}>{r.method}</span> <span className="break-all">{r.path}</span>
          </p>
          <p className="mt-2 text-sm text-dust">
            {r.status} · {r.duration_ms} мс · {(r.size / 1024).toFixed(1)} КБ · {r.ip} · {new Date(r.at).toLocaleTimeString('ru-RU')}
          </p>
        </div>
        <button onClick={onClose} aria-label="Закрыть" className="rounded-full p-2 text-dust hover:bg-seam hover:text-bone">
          <IconX size={18} />
        </button>
      </div>
      <div className="flex gap-6 border-b border-seam px-6">
        {(['req', 'res'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="relative py-3 text-sm">
            {t === 'req' ? 'Запрос' : 'Ответ'}
            {tab === t && <motion.span layoutId="detail-tab" className="absolute inset-x-0 -bottom-px h-0.5 bg-lamp" />}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-6 overflow-auto p-6">
        <table className="w-full font-mono text-[12.5px]">
          <tbody>
            {Object.entries(headers).map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="py-1 pr-4 text-dust">{k}</td>
                <td className="py-1 break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre className="overflow-auto rounded-2xl bg-soil p-4 font-mono text-[12.5px] leading-relaxed text-bone/90">{body || 'Тело пустое'}</pre>
      </div>
      <div className="border-t border-seam p-6">
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const res = await post<{ status: number; duration_ms: number }>(`/api/requests/${r.id}/replay`)
              toast(`Повтор отправлен: ${res.status} за ${res.duration_ms} мс`)
            } catch {
              toast('Не удалось повторить запрос: туннель выключен', 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          Повторить запрос
        </Button>
      </div>
    </motion.aside>
  )
}

export default function Inspector() {
  const tunnels = useTunnels()
  const [tunnel, setTunnel] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [q, setQ] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const reqs = useRequests(tunnel, live)
  const [sel, setSel] = useState<Req | null>(null)

  const rows = useMemo(
    () => (reqs.data ?? []).filter((r) => (!errorsOnly || r.status >= 400) && (!q || `${r.method} ${r.path}`.toLowerCase().includes(q.toLowerCase()))),
    [reqs.data, q, errorsOnly],
  )

  return (
    <>
      <PageHead
        title="Инспектор"
        sub="Все запросы через ваши туннели за последний час. Нажмите на строку, чтобы увидеть заголовки и тело."
        action={
          <Button variant="ghost" onClick={() => setLive(!live)}>
            {live ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
            {live ? 'Пауза' : 'Продолжить'}
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap gap-3">
        <select value={tunnel ?? ''} onChange={(e) => setTunnel(e.target.value || null)} className="h-11 rounded-full border border-seam bg-soil px-4 text-sm outline-none focus:border-lamp">
          <option value="">Все туннели</option>
          {tunnels.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.subdomain}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по пути, например /webhooks" className="h-11 min-w-56 flex-1 rounded-full border border-seam bg-soil px-4 text-sm outline-none focus:border-lamp" />
        <label className="flex h-11 items-center gap-2 rounded-full border border-seam px-4 text-sm">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="accent-[#ffb347]" />
          Только ошибки
        </label>
      </div>
      <div className="overflow-hidden rounded-3xl border border-seam">
        <div className="grid grid-cols-[64px_1fr_56px_72px] gap-3 border-b border-seam bg-clay/50 px-5 py-3 text-xs text-dust md:grid-cols-[64px_1fr_56px_72px_110px_90px]">
          <span>Метод</span>
          <span>Путь</span>
          <span>Код</span>
          <span className="text-right">Время</span>
          <span className="hidden md:block">IP</span>
          <span className="hidden text-right md:block">Когда</span>
        </div>
        {reqs.isLoading && <Skeleton className="m-5 h-40" />}
        <ul className="max-h-[62vh] overflow-auto font-mono text-[13px]">
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.li
                key={r.id}
                layout="position"
                initial={{ opacity: 0, backgroundColor: 'rgba(255,179,71,.14)' }}
                animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
                transition={{ duration: 1 }}
              >
                <button onClick={() => setSel(r)} className="grid w-full grid-cols-[64px_1fr_56px_72px] items-center gap-3 border-b border-seam/50 px-5 py-2.5 text-left hover:bg-clay/50 md:grid-cols-[64px_1fr_56px_72px_110px_90px]">
                  <span className={methodTone[r.method] ?? ''}>{r.method}</span>
                  <span className="truncate">{r.path}</span>
                  <span className={r.status >= 400 ? 'text-alarm' : 'text-bone/80'}>{r.status}</span>
                  <span className="text-right text-dust">{r.duration_ms} мс</span>
                  <span className="hidden truncate text-dust md:block">{r.ip}</span>
                  <span className="hidden text-right text-dust md:block">{new Date(r.at).toLocaleTimeString('ru-RU')}</span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
          {!reqs.isLoading && rows.length === 0 && <li className="p-10 text-center font-sans text-dust">Под фильтр ничего не подходит. Сбросьте поиск или включите туннель.</li>}
        </ul>
      </div>
      <AnimatePresence>
        {sel && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-soil/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSel(null)} />
            <Detail r={sel} onClose={() => setSel(null)} />
          </>
        )}
      </AnimatePresence>
    </>
  )
}
