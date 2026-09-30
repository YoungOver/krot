import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { IconActivity, IconCreditCard, IconKey, IconLayoutDashboard, IconLogout, IconRoute, IconSettings, IconWorld } from '@tabler/icons-react'
import { post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Logo } from '@/components/ui/kit'

const nav = [
  ['/app', 'Обзор', IconLayoutDashboard],
  ['/app/tunnels', 'Туннели', IconRoute],
  ['/app/inspector', 'Инспектор', IconActivity],
  ['/app/domains', 'Домены', IconWorld],
  ['/app/tokens', 'Токены', IconKey],
  ['/app/billing', 'Оплата', IconCreditCard],
  ['/app/settings', 'Настройки', IconSettings],
] as const

const planName = { free: 'Старт', pro: 'Про', team: 'Команда' }

export default function AppLayout() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const user = useAuth((s) => s.user)!
  const navTo = useNavigate()
  const qc = useQueryClient()

  async function logout() {
    await post('/api/auth/logout').catch(() => undefined)
    useAuth.getState().clear()
    qc.clear()
    navTo('/', { replace: true })
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-seam px-4 py-6 md:flex">
        <NavLink to="/" className="px-3" aria-label="На главную">
          <Logo />
        </NavLink>
        <nav className="mt-10 flex flex-1 flex-col gap-1">
          {nav.map(([to, label, Icon]) => {
            const active = to === '/app' ? pathname === '/app' : pathname.startsWith(to)
            return (
              <NavLink key={to} to={to} end={to === '/app'} className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px]">
                {active && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-clay-2" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <Icon size={19} className={`relative ${active ? 'text-lamp' : 'text-dust'}`} />
                <span className={`relative ${active ? 'text-bone' : 'text-bone/70'}`}>{label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="rounded-2xl border border-seam p-4">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-dust">{user.email}</p>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="rounded-full bg-lamp/15 px-2 py-0.5 text-lamp">{planName[user.plan]}</span>
            <button onClick={logout} className="flex items-center gap-1 text-dust hover:text-bone">
              <IconLogout size={14} /> Выйти
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 pb-24 md:pb-0">
        <header className="flex h-16 items-center justify-between border-b border-seam px-5 md:hidden">
          <Logo />
          <button onClick={logout} className="text-sm text-dust">
            Выйти
          </button>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12"
          >
            {outlet}
          </motion.main>
        </AnimatePresence>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-seam bg-soil/90 py-2 backdrop-blur md:hidden">
        {nav.slice(0, 5).map(([to, label, Icon]) => {
          const active = to === '/app' ? pathname === '/app' : pathname.startsWith(to)
          return (
            <NavLink key={to} to={to} end={to === '/app'} className={`flex flex-col items-center gap-1 px-2 text-[11px] ${active ? 'text-lamp' : 'text-dust'}`}>
              <Icon size={20} />
              {label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="display text-4xl md:text-5xl">{title}</h1>
        {sub && <p className="mt-3 max-w-xl text-dust">{sub}</p>}
      </div>
      {action}
    </div>
  )
}
