import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { User } from '@/lib/types'
import { Button, Field, Logo } from '@/components/ui/kit'

type Session = { access_token: string; user: User }

function useSubmit<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const run = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'network', 'Нет связи с сервером, попробуйте ещё раз'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function Login() {
  const nav = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit(async () => {
    const s = await post<Session>('/api/auth/login', { email, password })
    useAuth.getState().set(s.access_token, s.user)
    nav(from, { replace: true })
  })
  return (
    <form onSubmit={run} className="space-y-5" noValidate>
      <Field label="Почта" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field label="Пароль" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error?.message} required />
      <Button busy={busy} className="w-full">
        Войти
      </Button>
    </form>
  )
}

function Register() {
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const { busy, error, run } = useSubmit(async () => {
    const r = await post<{ pending_id: string; email: string }>('/api/auth/register', f)
    nav('/verify', { state: r })
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form onSubmit={run} className="space-y-5" noValidate>
      <Field label="Как к вам обращаться" name="name" autoComplete="name" value={f.name} onChange={set('name')} />
      <Field label="Почта" name="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={error?.code === 'email' || error?.code === 'exists' ? error.message : undefined} />
      <Field
        label="Пароль"
        name="password"
        type="password"
        autoComplete="new-password"
        value={f.password}
        onChange={set('password')}
        error={error?.code === 'password' ? error.message : undefined}
        hint={<PasswordMeter value={f.password} />}
      />
      {error && !['email', 'exists', 'password'].includes(error.code) && <p className="text-sm text-alarm">{error.message}</p>}
      <Button busy={busy} className="w-full">
        Получить код
      </Button>
    </form>
  )
}

function PasswordMeter({ value }: { value: string }) {
  const score = [value.length >= 8, /[A-ZА-Я]/.test(value) && /[a-zа-я]/.test(value), /\d/.test(value), /[^\w\s]/.test(value) || value.length >= 14].filter(Boolean).length
  const label = ['Минимум 8 символов', 'Слабый', 'Средний', 'Хороший', 'Надёжный'][value ? score : 0]
  return (
    <span className="flex items-center gap-3">
      <span className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <motion.span key={i} className="h-1 w-7 rounded-full" animate={{ backgroundColor: i < score ? (score >= 3 ? '#3ee6c1' : '#ffb347') : '#3a2a20' }} />
        ))}
      </span>
      {label}
    </span>
  )
}

function Verify() {
  const nav = useNavigate()
  const st = useLocation().state as { pending_id?: string; email?: string } | null
  const [digits, setDigits] = useState(Array(6).fill(''))
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const code = useRef('') // auto-submit fires before React re-renders, so read the latest code from a ref
  const { busy, error, run } = useSubmit(async () => {
    const s = await post<Session>('/api/auth/verify', { pending_id: st?.pending_id, code: code.current })
    useAuth.getState().set(s.access_token, s.user)
    nav('/app', { replace: true })
  })
  if (!st?.pending_id)
    return (
      <p className="text-bone/80">
        Сначала <Link to="/register" className="text-lamp underline">зарегистрируйтесь</Link>, код придёт на почту.
      </p>
    )

  const put = (i: number, v: string) => {
    const next = [...digits]
    next[i] = v
    setDigits(next)
    code.current = next.join('')
    if (v && i < 5) refs.current[i + 1]?.focus()
    if (next.every(Boolean)) setTimeout(() => run(), 0)
  }
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
  }
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const v = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (v.length === 6) {
      e.preventDefault()
      setDigits(v.split(''))
      code.current = v
      setTimeout(() => run(), 0)
    }
  }

  return (
    <form onSubmit={run} className="space-y-6">
      <p className="text-bone/80">
        Отправили шестизначный код на <span className="text-bone">{st.email}</span>. В демо подходит код <span className="font-mono text-lamp">424242</span>.
      </p>
      <motion.div className="flex gap-2" animate={error ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            value={d}
            onChange={(e) => put(i, e.target.value.replace(/\D/g, '').slice(-1))}
            onKeyDown={onKey(i)}
            onPaste={onPaste}
            inputMode="numeric"
            autoFocus={i === 0}
            aria-label={`Цифра ${i + 1}`}
            className="h-14 w-full rounded-xl border border-seam bg-soil/60 text-center font-mono text-2xl text-bone outline-none focus:border-lamp"
          />
        ))}
      </motion.div>
      {error && <p className="text-sm text-alarm">{error.message}</p>}
      <Button busy={busy} className="w-full">
        Подтвердить
      </Button>
    </form>
  )
}

const titles: Record<string, [string, string]> = {
  '/login': ['С возвращением', 'Войдите, чтобы управлять туннелями'],
  '/register': ['Аккаунт за минуту', 'Бесплатный тариф, карта не нужна'],
  '/verify': ['Проверьте почту', 'Осталось подтвердить адрес'],
}

export default function AuthLayout() {
  const { pathname } = useLocation()
  const [title, sub] = titles[pathname] ?? titles['/login']
  const tab = pathname === '/register' || pathname === '/verify' ? '/register' : '/login'
  return (
    <div className="grid min-h-dvh md:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-seam md:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_58%,#ffb34733_0,#ffb34714_12%,transparent_38%),repeating-radial-gradient(circle_at_50%_58%,#241913_0_18px,#1a120d_18px_36px)]" />
        <motion.div
          className="absolute top-[58%] left-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lamp/40 blur-3xl"
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link to="/" aria-label="На главную">
            <Logo />
          </Link>
          <p className="display max-w-md text-4xl leading-tight">Туннель ждёт на том же адресе, где вы его оставили</p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-16">
        <motion.div layout className="w-full max-w-md rounded-[28px] border border-seam bg-clay/50 p-8 md:p-10" transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
          <div className="mb-8 md:hidden">
            <Logo />
          </div>
          <div className="mb-8 flex rounded-full border border-seam p-1 text-sm">
            {[
              ['/login', 'Вход'],
              ['/register', 'Регистрация'],
            ].map(([to, label]) => (
              <Link key={to} to={to} className="relative flex-1 rounded-full py-2 text-center">
                {tab === to && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-full bg-clay-2" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative">{label}</span>
              </Link>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={pathname} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
              <h1 className="display text-3xl">{title}</h1>
              <p className="mt-2 mb-8 text-dust">{sub}</p>
              {pathname === '/register' ? <Register /> : pathname === '/verify' ? <Verify /> : <Login />}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  )
}
