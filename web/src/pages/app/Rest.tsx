import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import clsx from 'clsx'
import { ApiError, del, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useBilling, useChangePlan, useDomains, useSessions, useTokens, useUpdateMe } from '@/lib/queries'
import type { ApiToken, Domain, Plan } from '@/lib/types'
import { Button, Field, Modal, Skeleton, StatusDot } from '@/components/ui/kit'
import { toast } from '@/components/ui/Toast'
import { PageHead } from './AppLayout'

const dateFmt = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

export function DomainsPage() {
  const { data, isLoading } = useDomains()
  const qc = useQueryClient()
  const [host, setHost] = useState('')
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  return (
    <>
      <PageHead title="Домены" sub="Подключите свой домен: адрес туннеля останется за вами, даже если вы смените компьютер." />
      <form
        className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setErr(undefined)
          try {
            const d = await post<Domain>('/api/domains', { host: host.trim().toLowerCase() })
            qc.setQueryData<Domain[]>(['domains'], (xs = []) => [...xs, d])
            setHost('')
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Не удалось добавить домен')
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Домен" name="host" placeholder="api.shop.ru" value={host} onChange={(e) => setHost(e.target.value)} error={err} className="flex-1" />
        <Button busy={busy} className="sm:mt-7">
          Добавить
        </Button>
      </form>
      {isLoading && <Skeleton className="h-28" />}
      <ul className="space-y-4">
        {data?.map((d) => (
          <motion.li layout key={d.id} className="rounded-2xl border border-seam p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusDot status={d.status} />
              <span className="flex-1 font-mono">{d.host}</span>
              <span className={clsx('text-sm', d.status === 'active' ? 'text-signal' : 'text-lamp')}>{d.status === 'active' ? 'Работает, сертификат выпущен' : 'Ждём DNS-запись'}</span>
            </div>
            {d.status === 'pending' && (
              <div className="mt-4 rounded-xl bg-clay/60 p-4 text-sm">
                <p className="text-dust">Добавьте запись у регистратора домена:</p>
                <p className="mt-2 font-mono text-bone">
                  {d.host} CNAME {d.cname}
                </p>
                <Button
                  variant="ghost"
                  className="mt-4 h-9 px-4 text-sm"
                  busy={checking === d.id}
                  onClick={async () => {
                    setChecking(d.id)
                    const upd = await post<Domain>(`/api/domains/${d.id}/check`).finally(() => setChecking(null))
                    qc.setQueryData<Domain[]>(['domains'], (xs = []) => xs.map((x) => (x.id === d.id ? upd : x)))
                    toast(`${d.host} подключён`)
                  }}
                >
                  Проверить запись
                </Button>
              </div>
            )}
          </motion.li>
        ))}
        {data?.length === 0 && <li className="rounded-2xl border border-dashed border-seam p-8 text-dust">Своих доменов пока нет. Туннели работают на адресах вида name.krot.dev.</li>}
      </ul>
    </>
  )
}

export function TokensPage() {
  const { data, isLoading } = useTokens()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<ApiToken | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  return (
    <>
      <PageHead title="Токены" sub="Токен связывает клиент krot на компьютере или в CI с вашим аккаунтом. Отзовите токен, если устройство потеряно." />
      <form
        className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setErr(undefined)
          try {
            const t = await post<ApiToken>('/api/tokens', { name })
            setCreated(t)
            setName('')
            qc.invalidateQueries({ queryKey: ['tokens'] })
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Не удалось создать токен')
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Название" name="name" placeholder="Ноутбук, CI, сервер разработки" value={name} onChange={(e) => setName(e.target.value)} error={err} className="flex-1" />
        <Button busy={busy} className="sm:mt-7">
          Создать токен
        </Button>
      </form>
      {isLoading && <Skeleton className="h-24" />}
      <ul className="divide-y divide-seam rounded-2xl border border-seam">
        <AnimatePresence initial={false}>
          {data?.map((t) => (
            <motion.li key={t.id} layout exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <span className="font-semibold">{t.name}</span>
              <span className="font-mono text-sm text-dust">{t.prefix}…</span>
              <span className="flex-1 text-sm text-dust">создан {dateFmt(t.created_at)}, {t.last_used ? `использован ${dateFmt(t.last_used)}` : 'ещё не использовался'}</span>
              <Button
                variant="danger"
                className="h-9 px-4 text-sm"
                onClick={async () => {
                  await del(`/api/tokens/${t.id}`)
                  qc.setQueryData<ApiToken[]>(['tokens'], (xs = []) => xs.filter((x) => x.id !== t.id))
                  toast(`Токен «${t.name}» отозван`)
                }}
              >
                Отозвать
              </Button>
            </motion.li>
          ))}
        </AnimatePresence>
        {data?.length === 0 && <li className="p-8 text-dust">Токенов нет. Создайте первый и выполните krot login с ним.</li>}
      </ul>
      <Modal open={!!created} onClose={() => setCreated(null)} title="Токен создан">
        <p className="text-dust">Скопируйте токен сейчас: после закрытия окна он больше не будет показан.</p>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(created?.secret ?? '')
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          className="mt-5 flex w-full items-center justify-between gap-3 rounded-xl bg-soil p-4 text-left font-mono text-sm break-all"
        >
          {created?.secret}
          {copied ? <IconCheck className="shrink-0 text-signal" size={18} /> : <IconCopy className="shrink-0 text-dust" size={18} />}
        </button>
        <p className="mt-4 font-mono text-sm text-dust">krot login {created?.secret?.slice(0, 14)}…</p>
        <Button className="mt-6 w-full" onClick={() => setCreated(null)}>
          Готово, скопировал
        </Button>
      </Modal>
    </>
  )
}

const planInfo: Record<Plan, { name: string; price: number }> = { free: { name: 'Старт', price: 0 }, pro: { name: 'Про', price: 690 }, team: { name: 'Команда', price: 2490 } }

function Meter({ label, value, limit }: { label: string; value: number; limit: number }) {
  const pct = Math.min(100, (value / limit) * 100)
  const f = new Intl.NumberFormat('ru-RU')
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-dust">
          {f.format(value)} из {f.format(limit)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-seam">
        <motion.div className={clsx('h-full rounded-full', pct > 85 ? 'bg-alarm' : 'bg-lamp')} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </div>
  )
}

export function BillingPage() {
  const { data, isLoading } = useBilling()
  const change = useChangePlan()
  const [target, setTarget] = useState<Plan | null>(null)
  if (isLoading || !data) return <Skeleton className="h-80" />
  return (
    <>
      <PageHead title="Оплата" sub={`Тариф «${planInfo[data.plan].name}»${data.plan === 'free' ? '' : `, следующее списание ${dateFmt(data.renews_at)}`}`} />
      <section className="grid gap-6 rounded-3xl border border-seam p-6 md:grid-cols-2">
        <Meter label="Туннели" value={data.usage.tunnels} limit={data.usage.tunnels_limit} />
        <Meter label="Запросы за месяц" value={data.usage.requests} limit={data.usage.requests_limit} />
      </section>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {(Object.keys(planInfo) as Plan[]).map((p) => (
          <button
            key={p}
            onClick={() => p !== data.plan && setTarget(p)}
            className={clsx('relative rounded-3xl border p-6 text-left transition-colors', p === data.plan ? 'border-lamp' : 'border-seam hover:border-dust')}
          >
            {p === data.plan && <motion.span layoutId="current-plan" className="absolute inset-0 -z-10 rounded-3xl bg-lamp/10" />}
            <p className="font-semibold">{planInfo[p].name}</p>
            <p className="display mt-3 text-4xl">{planInfo[p].price.toLocaleString('ru-RU')} ₽</p>
            <p className="mt-3 text-sm text-dust">{p === data.plan ? 'Текущий тариф' : 'Перейти на этот тариф'}</p>
          </button>
        ))}
      </div>
      <h2 className="mt-12 mb-4 text-lg font-semibold">Счета</h2>
      <ul className="divide-y divide-seam rounded-2xl border border-seam">
        {data.invoices.map((i) => (
          <li key={i.id} className="flex items-center justify-between px-5 py-4 text-sm">
            <span>{i.period}</span>
            <span className="text-dust">{i.amount.toLocaleString('ru-RU')} ₽</span>
            <span className="text-signal">Оплачен</span>
          </li>
        ))}
        {data.invoices.length === 0 && <li className="p-6 text-dust">На бесплатном тарифе счетов нет.</li>}
      </ul>
      <Modal open={!!target} onClose={() => setTarget(null)} title={target ? `Тариф «${planInfo[target].name}»` : ''}>
        <p className="text-bone/80">
          {target === 'free'
            ? 'Лимиты уменьшатся до 1 туннеля, постоянные адреса и свои домены отключатся в конце оплаченного периода.'
            : `Спишем ${target ? planInfo[target].price : 0} ₽ с сохранённой карты, лимиты обновятся сразу. В демо деньги не списываются.`}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setTarget(null)}>
            Отмена
          </Button>
          <Button
            busy={change.isPending}
            onClick={() =>
              target &&
              change.mutate(target, {
                onSuccess: () => {
                  toast(`Тариф «${planInfo[target].name}» подключён`)
                  setTarget(null)
                },
              })
            }
          >
            Подтвердить
          </Button>
        </div>
      </Modal>
    </>
  )
}

export function SettingsPage() {
  const user = useAuth((s) => s.user)!
  const upd = useUpdateMe()
  const sessions = useSessions()
  const qc = useQueryClient()
  const [name, setName] = useState(user.name)
  return (
    <>
      <PageHead title="Настройки" />
      <section className="rounded-3xl border border-seam p-6">
        <h2 className="mb-5 text-lg font-semibold">Профиль</h2>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            upd.mutate({ name }, { onSuccess: () => toast('Имя сохранено') })
          }}
        >
          <Field label="Имя" name="name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Field label="Почта" name="email" value={user.email} disabled className="flex-1" />
          <Button busy={upd.isPending}>Сохранить</Button>
        </form>
      </section>
      <section className="mt-6 flex items-center justify-between gap-6 rounded-3xl border border-seam p-6">
        <div>
          <h2 className="text-lg font-semibold">Двухфакторная защита</h2>
          <p className="mt-1 max-w-md text-sm text-dust">При входе с нового устройства попросим код из приложения-аутентификатора.</p>
        </div>
        <button
          role="switch"
          aria-checked={user.twofa}
          aria-label="Двухфакторная защита"
          onClick={() => upd.mutate({ twofa: !user.twofa }, { onSuccess: (u) => toast(u.twofa ? 'Двухфакторная защита включена' : 'Двухфакторная защита выключена') })}
          className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors ${user.twofa ? 'justify-end bg-signal/80' : 'justify-start bg-seam'}`}
        >
          <motion.span layout className="size-5 rounded-full bg-bone" />
        </button>
      </section>
      <section className="mt-6 rounded-3xl border border-seam p-6">
        <h2 className="mb-5 text-lg font-semibold">Активные сессии</h2>
        <ul className="divide-y divide-seam">
          <AnimatePresence initial={false}>
            {sessions.data?.map((s) => (
              <motion.li key={s.id} layout exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-4 py-4">
                <div className="flex-1">
                  <p>{s.agent}</p>
                  <p className="text-sm text-dust">
                    {s.city}, {s.ip}, {s.current ? 'это устройство' : `была активна ${new Date(s.last_seen).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    variant="ghost"
                    className="h-9 px-4 text-sm"
                    onClick={async () => {
                      await del(`/api/sessions/${s.id}`)
                      qc.setQueryData(['sessions'], (xs: typeof sessions.data = []) => xs.filter((x) => x.id !== s.id))
                      toast('Сессия завершена')
                    }}
                  >
                    Завершить
                  </Button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>
    </>
  )
}
