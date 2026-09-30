import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Link } from 'react-router'
import clsx from 'clsx'
import { Button, Logo } from '@/components/ui/kit'
import { toast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth'

export function Nav() {
  const user = useAuth((s) => s.user)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header className={clsx('fixed inset-x-0 top-0 z-40 transition-[background-color,backdrop-filter,border-color] duration-300', scrolled ? 'border-b border-seam/60 bg-soil/75 backdrop-blur-lg' : 'border-b border-transparent')}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
        <Link to="/" aria-label="На главную">
          <Logo />
        </Link>
        <div className="hidden items-center gap-8 text-[15px] text-bone/75 md:flex">
          <a href="#how" className="hover:text-bone">Как работает</a>
          <a href="#inspector" className="hover:text-bone">Инспектор</a>
          <a href="#pricing" className="hover:text-bone">Тарифы</a>
          <a href="#faq" className="hover:text-bone">Вопросы</a>
        </div>
        {user ? (
          <Link to="/app">
            <Button className="h-10 px-5">Кабинет</Button>
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden px-3 text-[15px] text-bone/80 hover:text-bone sm:block">
              Войти
            </Link>
            <Link to="/register">
              <Button className="h-10 px-5">Начать</Button>
            </Link>
          </div>
        )}
      </nav>
    </header>
  )
}

const steps = [
  { title: 'Поставьте клиент', cmd: 'curl -fsSL https://krot.dev/install.sh | sh', note: 'macOS, Linux и Windows. Один бинарник, без зависимостей.' },
  { title: 'Войдите один раз', cmd: 'krot login krt_9f2c…', note: 'Токен берётся в кабинете. Клиент хранит его в системном хранилище ключей.' },
  { title: 'Откройте порт', cmd: 'krot http 3000 --domain shop.krot.dev', note: 'Адрес постоянный: вебхуки не придётся перенастраивать после перезапуска.' },
]

export function Steps() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-28 md:px-8">
      <h2 className="display max-w-3xl text-[clamp(2.2rem,5vw,4rem)]">Три шага от ноутбука до публичного адреса</h2>
      <ol className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-seam bg-seam md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-5 bg-soil p-7">
            <span className="display text-5xl text-lamp/90">{i + 1}</span>
            <h3 className="text-xl font-semibold">{s.title}</h3>
            <button
              onClick={() => navigator.clipboard?.writeText(s.cmd).then(() => toast('Команда скопирована'))}
              className="group flex items-center justify-between gap-3 rounded-xl bg-clay px-4 py-3 text-left font-mono text-[13px] text-bone/90 transition hover:bg-clay-2"
              title="Скопировать"
            >
              <span className="truncate">{s.cmd}</span>
              <span className="shrink-0 text-xs text-dust group-hover:text-lamp">копировать</span>
            </button>
            <p className="text-[15px] leading-relaxed text-dust">{s.note}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

type DemoReq = { id: number; m: string; path: string; st: number; ms: number; body: string }
const pool: Omit<DemoReq, 'id'>[] = [
  { m: 'POST', path: '/webhooks/yookassa', st: 200, ms: 64, body: '{\n  "event": "payment.succeeded",\n  "object": { "id": "2e9a…", "amount": { "value": "1490.00", "currency": "RUB" } }\n}' },
  { m: 'GET', path: '/api/products?page=2', st: 200, ms: 22, body: '' },
  { m: 'POST', path: '/webhooks/telegram', st: 200, ms: 41, body: '{\n  "update_id": 88121,\n  "message": { "chat": { "id": 5512 }, "text": "/start" }\n}' },
  { m: 'POST', path: '/api/login', st: 422, ms: 29, body: '{\n  "email": "anna@",\n  "password": "••••••"\n}' },
  { m: 'PATCH', path: '/api/cart', st: 200, ms: 35, body: '{\n  "sku": "TEA-11",\n  "qty": 2\n}' },
  { m: 'POST', path: '/api/upload', st: 500, ms: 312, body: '(multipart, 2.4 МБ)' },
]

export function InspectorDemo() {
  const [items, setItems] = useState<DemoReq[]>(() => pool.slice(0, 4).map((p, i) => ({ ...p, id: i })))
  const [open, setOpen] = useState<number | null>(0)
  const [replaying, setReplaying] = useState(false)
  useEffect(() => {
    let n = 100
    const t = window.setInterval(() => setItems((xs) => [{ ...pool[Math.floor(Math.random() * pool.length)], id: n++ }, ...xs].slice(0, 6)), 2600)
    return () => clearInterval(t)
  }, [])
  const sel = items.find((x) => x.id === open) ?? null

  return (
    <section id="inspector" className="border-y border-seam bg-clay/40">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-28 md:grid-cols-[1fr_1.35fr] md:px-8">
        <div>
          <h2 className="display text-[clamp(2.2rem,5vw,4rem)]">Каждый запрос виден и повторяется</h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-bone/75">
            Инспектор показывает заголовки и тело всех запросов, прошедших через туннель. Упал вебхук оплаты: исправьте код и отправьте тот же запрос ещё раз, не дожидаясь нового платежа.
          </p>
        </div>
        <LayoutGroup>
          <div className="overflow-hidden rounded-3xl border border-seam bg-soil">
            <ul className="divide-y divide-seam/70">
              <AnimatePresence initial={false}>
                {items.map((r) => (
                  <motion.li key={r.id} layout initial={{ opacity: 0, backgroundColor: 'rgba(255,179,71,.12)' }} animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }} transition={{ duration: 1.2 }}>
                    <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left font-mono text-[13px] hover:bg-clay/60" aria-expanded={open === r.id}>
                      <span className="w-12 text-dust">{r.m}</span>
                      <span className="flex-1 truncate text-bone">{r.path}</span>
                      <span className={r.st >= 400 ? 'text-alarm' : 'text-signal'}>{r.st}</span>
                      <span className="w-14 text-right text-dust">{r.ms} мс</span>
                    </button>
                    <AnimatePresence initial={false}>
                      {sel?.id === r.id && (
                        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="flex flex-col gap-3 px-5 pb-5">
                            <pre className="max-h-40 overflow-auto rounded-xl bg-clay p-4 font-mono text-xs leading-relaxed text-bone/85">{r.body || 'Тело пустое'}</pre>
                            <Button
                              variant="ghost"
                              className="h-9 self-start px-4 text-sm"
                              busy={replaying}
                              onClick={() => {
                                setReplaying(true)
                                setTimeout(() => {
                                  setReplaying(false)
                                  toast(`Повтор ${r.m} ${r.path}: 200 за ${20 + Math.round(Math.random() * 40)} мс`)
                                }, 700)
                              }}
                            >
                              Повторить запрос
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </LayoutGroup>
      </div>
    </section>
  )
}

function Price({ value }: { value: number }) {
  const mv = useMotionValue(value)
  const spring = useSpring(mv, { stiffness: 140, damping: 22 })
  const text = useTransform(spring, (v) => Math.round(v).toLocaleString('ru-RU'))
  useEffect(() => mv.set(value), [mv, value])
  return <motion.span>{text}</motion.span>
}

const plans = [
  { key: 'free', name: 'Старт', month: 0, lines: ['1 туннель', 'Случайный адрес при каждом запуске', '20 000 запросов в месяц', 'Инспектор за последний час'] },
  { key: 'pro', name: 'Про', month: 690, lines: ['10 туннелей', 'Постоянные адреса и свои домены', '2 млн запросов в месяц', 'Повтор запросов, история за 30 дней', 'Защита паролем и по IP'] },
  { key: 'team', name: 'Команда', month: 2490, lines: ['50 туннелей на команду', 'Общие домены и роли', 'SSO и журнал действий', 'Выделенный узел в регионе'] },
]

export function Pricing() {
  const [yearly, setYearly] = useState(false)
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-5 py-28 md:px-8">
      <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
        <h2 className="display max-w-2xl text-[clamp(2.2rem,5vw,4rem)]">Платите, когда туннель стал рабочим инструментом</h2>
        <div role="radiogroup" aria-label="Период оплаты" className="relative flex rounded-full border border-seam p-1 text-sm">
          {[
            ['Помесячно', false],
            ['За год, скидка 20%', true],
          ].map(([label, v]) => (
            <button key={String(v)} role="radio" aria-checked={yearly === v} onClick={() => setYearly(v as boolean)} className="relative z-10 rounded-full px-4 py-2">
              {yearly === v && <motion.span layoutId="period" className="absolute inset-0 -z-10 rounded-full bg-lamp" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <span className={yearly === v ? 'text-soil' : 'text-bone/80'}>{label as string}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {plans.map((p) => {
          const price = yearly ? Math.round(p.month * 0.8) : p.month
          const featured = p.key === 'pro'
          return (
            <div key={p.key} className={clsx('flex flex-col rounded-[28px] p-8', featured ? 'bg-lamp text-soil' : 'border border-seam bg-clay/40')}>
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="display text-6xl">
                  <Price value={price} />
                </span>
                <span className={featured ? 'text-soil/70' : 'text-dust'}>₽ в месяц</span>
              </div>
              <ul className="mt-8 flex-1 space-y-3 text-[15px]">
                {p.lines.map((l) => (
                  <li key={l} className="flex gap-3">
                    <span className={clsx('mt-2 size-1.5 shrink-0 rounded-full', featured ? 'bg-soil' : 'bg-lamp')} />
                    {l}
                  </li>
                ))}
              </ul>
              <Link to="/register" className="mt-10">
                <Button variant={featured ? 'ghost' : 'lamp'} className={clsx('w-full', featured && 'border-soil/30 text-soil hover:bg-soil/10')}>
                  {p.month === 0 ? 'Начать бесплатно' : `Выбрать «${p.name}»`}
                </Button>
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const faq = [
  ['Чем Крот отличается от проброса портов на роутере?', 'Не нужен белый IP и доступ к роутеру. Клиент сам устанавливает исходящее соединение с ближайшим узлом, поэтому работает из офиса, кафе и за мобильным интернетом.'],
  ['Кто видит мой трафик?', 'TLS завершается на узле Крота, дальше данные идут по тому же зашифрованному соединению до вашего клиента. Тела запросов хранятся только для инспектора и удаляются по сроку тарифа.'],
  ['Можно подключить свой домен?', 'Да, на тарифе «Про». Добавьте CNAME на адрес из кабинета, сертификат Let’s Encrypt выпустится автоматически.'],
  ['Где стоят узлы?', 'Москва, Санкт-Петербург, Амстердам и Франкфурт. Клиент выбирает ближайший по задержке, регион можно задать вручную.'],
  ['Подходит для продакшена?', 'Для небольших сервисов и внутренних инструментов да: SLA 99,9% на тарифе «Команда». Для высокой нагрузки лучше полноценный хостинг.'],
]

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="mx-auto grid max-w-7xl gap-12 px-5 pb-28 md:grid-cols-[1fr_1.4fr] md:px-8">
      <h2 className="display text-[clamp(2.2rem,5vw,4rem)]">Частые вопросы</h2>
      <div className="divide-y divide-seam border-y border-seam">
        {faq.map(([q, a], i) => (
          <div key={q}>
            <button className="flex w-full items-center justify-between gap-6 py-6 text-left text-lg" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              {q}
              <motion.span animate={{ rotate: open === i ? 45 : 0 }} className="shrink-0 text-2xl text-lamp">
                +
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pr-10 text-[16px] leading-relaxed text-bone/70">
                  <span className="block pb-6">{a}</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  )
}

export function Footer() {
  const year = useMemo(() => new Date().getFullYear(), [])
  return (
    <footer className="border-t border-seam">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 py-10 text-sm text-dust md:flex-row md:items-center md:px-8">
        <Logo />
        <p>Демо-проект. Все данные в кабинете генерируются в браузере.</p>
        <p>© {year} Крот</p>
      </div>
    </footer>
  )
}
