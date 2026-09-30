import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router'
import { Button } from '@/components/ui/kit'
import { useTunnel } from '@/components/tunnelStore'

const Tunnel3D = lazy(() => import('@/components/Tunnel3D'))

type Line = { id: number; kind: 'cmd' | 'info' | 'url' | 'req'; text: string; status?: number }

const words = ['тихий', 'сонный', 'рыжий', 'быстрый', 'северный']
const translit: Record<string, string> = { тихий: 'tihiy', сонный: 'sonniy', рыжий: 'ryzhiy', быстрый: 'bystriy', северный: 'severniy' }
const sample = [
  ['GET', '/', 200, 34],
  ['POST', '/webhooks/yookassa', 200, 61],
  ['GET', '/api/cart', 200, 18],
  ['POST', '/api/login', 422, 27],
  ['GET', '/static/app.js', 200, 9],
] as const

// The one orchestrated moment of the page: a command opens a tunnel and requests
// start flowing through the shaft behind it.
function Terminal() {
  const [port, setPort] = useState('3000')
  const [lines, setLines] = useState<Line[]>([])
  const [running, setRunning] = useState(false)
  const timers = useRef<number[]>([])
  const seq = useRef(0)
  const fire = useTunnel((s) => s.fire)
  const setSpeed = useTunnel((s) => s.setSpeed)

  const push = (l: Omit<Line, 'id'>) => setLines((ls) => [...ls.slice(-7), { ...l, id: ++seq.current }])
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))

  function run(p = port) {
    const n = Number(p)
    if (!(n > 0 && n < 65536)) {
      push({ kind: 'info', text: 'Порт должен быть числом от 1 до 65535' })
      return
    }
    timers.current.forEach(clearTimeout)
    timers.current = []
    setRunning(true)
    setLines([])
    const w = words[Math.floor(Math.random() * words.length)]
    const host = `${translit[w]}-krot-${n}.krot.dev`
    push({ kind: 'cmd', text: `krot http ${n}` })
    later(350, () => push({ kind: 'info', text: 'Подключаемся к узлу spb-2…' }))
    later(900, () => {
      setSpeed(3.2)
      push({ kind: 'url', text: `https://${host}` })
    })
    later(1500, () => setSpeed(1))
    sample.forEach(([m, path, st, ms], i) =>
      later(1700 + i * 650, () => {
        fire(1)
        push({ kind: 'req', text: `${m.padEnd(5)} ${path}  ${ms}мс`, status: st })
      }),
    )
    later(1700 + sample.length * 650, () => setRunning(false))
  }

  useEffect(() => {
    const t = window.setTimeout(() => run('3000'), 1400)
    return () => {
      clearTimeout(t)
      timers.current.forEach(clearTimeout)
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-seam/80 bg-soil/80 font-mono text-[13px] shadow-[0_30px_90px_-20px_rgba(0,0,0,.9)] backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-seam/70 px-4 py-2.5 text-dust">
        <span className="size-2.5 rounded-full bg-seam" />
        <span className="size-2.5 rounded-full bg-seam" />
        <span className="size-2.5 rounded-full bg-seam" />
        <span className="ml-2 text-xs">терминал</span>
      </div>
      <div className="h-[212px] space-y-1.5 px-4 pt-3" aria-live="polite">
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.div key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="truncate">
              {l.kind === 'cmd' && (
                <span>
                  <span className="text-lamp">$</span> {l.text}
                </span>
              )}
              {l.kind === 'info' && <span className="text-dust">{l.text}</span>}
              {l.kind === 'url' && (
                <span>
                  <span className="text-signal">●</span> <span className="text-bone">{l.text}</span> <span className="text-dust">→ localhost:{port}</span>
                </span>
              )}
              {l.kind === 'req' && (
                <span className="text-bone/90">
                  {l.text} <span className={l.status! >= 400 ? 'text-alarm' : 'text-signal'}>{l.status}</span>
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <form
        className="flex items-center gap-2 border-t border-seam/70 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <span className="text-lamp">$</span>
        <span className="text-dust">krot http</span>
        <input
          aria-label="Локальный порт"
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
          className="w-16 rounded-md bg-clay px-2 py-1 text-bone outline-none focus:ring-1 focus:ring-lamp"
          inputMode="numeric"
        />
        <button disabled={running} className="ml-auto rounded-full bg-lamp/15 px-3 py-1 text-lamp transition hover:bg-lamp/25 disabled:opacity-40">
          Запустить
        </button>
      </form>
    </div>
  )
}

const headline = ['Локалхост', 'наружу', 'одной командой']

export function Hero() {
  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <div className="absolute inset-0">
        <Suspense fallback={<div className="size-full bg-soil" />}>
          <Tunnel3D />
        </Suspense>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_60%,transparent_20%,#120d0a_85%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-soil" />
      </div>

      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-end gap-10 px-5 pt-28 pb-16 md:flex-row md:items-end md:justify-between md:px-8 md:pb-24">
        <div className="max-w-3xl">
          <h1 className="display text-[clamp(3rem,9vw,8.5rem)] text-bone">
            {headline.map((w, i) => (
              <motion.span
                key={w}
                className="block"
                initial={{ y: '105%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.25 + i * 0.12, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              >
                {w}
              </motion.span>
            ))}
          </h1>
          <motion.p
            className="mt-6 max-w-xl text-lg leading-relaxed text-bone/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            Крот даёт вашему локальному серверу постоянный HTTPS-адрес. Показывайте вёрстку заказчику, принимайте вебхуки от ЮKassa и Telegram, отлаживайте мобильное приложение с реальным бэкендом.
          </motion.p>
          <motion.div className="mt-8 flex flex-wrap gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
            <Link to="/register">
              <Button>Создать аккаунт бесплатно</Button>
            </Link>
            <a href="#how">
              <Button variant="ghost">Как это работает</Button>
            </a>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.8 }}>
          <Terminal />
        </motion.div>
      </div>
    </section>
  )
}
