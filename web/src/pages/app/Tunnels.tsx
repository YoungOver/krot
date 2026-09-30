import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { IconCopy, IconTrash } from '@tabler/icons-react'
import { ApiError } from '@/lib/api'
import { useCreateTunnel, useDeleteTunnel, usePauseTunnel, useTunnels } from '@/lib/queries'
import type { Region, Tunnel } from '@/lib/types'
import { Button, Field, Modal, Skeleton, StatusDot } from '@/components/ui/kit'
import { toast } from '@/components/ui/Toast'
import { PageHead } from './AppLayout'

const regions: [Region, string][] = [
  ['spb', 'Санкт-Петербург'],
  ['msk', 'Москва'],
  ['ams', 'Амстердам'],
  ['fra', 'Франкфурт'],
]

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${on ? 'justify-end bg-signal/80' : 'justify-start bg-seam'}`}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className="size-5 rounded-full bg-bone" />
    </button>
  )
}

function CreateTunnel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTunnel()
  const [f, setF] = useState({ proto: 'http' as 'http' | 'tcp', local_port: '8080', subdomain: '', region: 'spb' as Region })
  const err = create.error instanceof ApiError ? create.error : null
  return (
    <Modal open={open} onClose={onClose} title="Новый туннель">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate(
            { ...f, local_port: Number(f.local_port), subdomain: f.subdomain.trim().toLowerCase() },
            {
              onSuccess: (t) => {
                toast(`Туннель ${t.url} открыт`)
                onClose()
                create.reset()
                setF({ ...f, subdomain: '' })
              },
            },
          )
        }}
      >
        <div className="flex rounded-full border border-seam p-1 text-sm">
          {(['http', 'tcp'] as const).map((p) => (
            <button type="button" key={p} onClick={() => setF({ ...f, proto: p })} className="relative flex-1 rounded-full py-2">
              {f.proto === p && <motion.span layoutId="proto" className="absolute inset-0 rounded-full bg-clay-2" />}
              <span className="relative">{p === 'http' ? 'HTTP(S)' : 'TCP'}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <Field label="Локальный порт" name="port" inputMode="numeric" value={f.local_port} onChange={(e) => setF({ ...f, local_port: e.target.value.replace(/\D/g, '') })} error={err?.code === 'port' ? err.message : undefined} />
          <Field
            label="Поддомен"
            name="subdomain"
            placeholder="shop-dev"
            value={f.subdomain}
            onChange={(e) => setF({ ...f, subdomain: e.target.value })}
            error={['subdomain', 'taken'].includes(err?.code ?? '') ? err!.message : undefined}
            hint={f.subdomain && <span className="font-mono">{f.subdomain.toLowerCase()}.krot.dev</span>}
          />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm text-dust">Регион узла</span>
          <select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value as Region })} className="h-12 w-full rounded-xl border border-seam bg-soil/60 px-3 text-bone outline-none focus:border-lamp">
            {regions.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {err?.code === 'limit' && <p className="rounded-xl bg-lamp/10 p-3 text-sm text-lamp">{err.message}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button busy={create.isPending}>Открыть туннель</Button>
        </div>
      </form>
    </Modal>
  )
}

function Row({ t }: { t: Tunnel }) {
  const pause = usePauseTunnel()
  const remove = useDeleteTunnel()
  const [confirm, setConfirm] = useState(false)
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30, transition: { duration: 0.2 } }} className="rounded-2xl border border-seam bg-clay/40 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <StatusDot status={t.status} />
        <div className="min-w-0 flex-1">
          <button onClick={() => navigator.clipboard?.writeText(t.url).then(() => toast('Адрес скопирован'))} className="group flex max-w-full items-center gap-2 font-mono text-[15px] text-bone">
            <span className="truncate">{t.url}</span>
            <IconCopy size={15} className="shrink-0 text-dust group-hover:text-lamp" />
          </button>
          <p className="mt-1 text-sm text-dust">
            {t.proto.toUpperCase()} → localhost:{t.local_port} · {regions.find((r) => r[0] === t.region)?.[1]} · {new Intl.NumberFormat('ru-RU').format(t.requests_24h)} запросов за сутки
          </p>
        </div>
        <Switch on={t.status === 'online'} label="Туннель включён" onChange={(v) => pause.mutate({ id: t.id, paused: !v })} />
        <button aria-label="Удалить туннель" onClick={() => setConfirm(true)} className="rounded-full p-2 text-dust hover:bg-alarm/10 hover:text-alarm">
          <IconTrash size={18} />
        </button>
      </div>
      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-alarm/10 p-4 text-sm">
              <span>Адрес {t.subdomain}.krot.dev освободится, вебхуки на него перестанут приходить.</span>
              <span className="flex gap-2">
                <Button variant="ghost" className="h-9 px-4" onClick={() => setConfirm(false)}>
                  Оставить
                </Button>
                <Button variant="danger" className="h-9 px-4" busy={remove.isPending} onClick={() => remove.mutate(t.id, { onSuccess: () => toast('Туннель удалён') })}>
                  Удалить
                </Button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

export default function Tunnels() {
  const { data, isLoading } = useTunnels()
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHead title="Туннели" sub="Каждый туннель ведёт на порт вашего компьютера. Выключенный туннель сохраняет адрес." action={<Button onClick={() => setOpen(true)}>Новый туннель</Button>} />
      <ul className="space-y-4">
        {isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-24" />)}
        <AnimatePresence>{data?.map((t) => <Row key={t.id} t={t} />)}</AnimatePresence>
      </ul>
      {data?.length === 0 && (
        <div className="rounded-3xl border border-dashed border-seam p-10 text-center">
          <p className="display text-2xl">Пока пусто</p>
          <p className="mx-auto mt-3 max-w-sm text-dust">Откройте первый туннель и получите адрес, который можно отправить заказчику или вставить в настройки вебхука.</p>
          <Button className="mt-6" onClick={() => setOpen(true)}>
            Открыть туннель
          </Button>
        </div>
      )}
      <CreateTunnel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
