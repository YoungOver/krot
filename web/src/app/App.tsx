import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { refreshSession } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Toaster } from '@/components/ui/Toast'
import { Landing } from '@/pages/landing/Landing'

const AuthLayout = lazy(() => import('@/pages/auth/AuthLayout'))
const AppLayout = lazy(() => import('@/pages/app/AppLayout'))
const Overview = lazy(() => import('@/pages/app/Overview'))
const Tunnels = lazy(() => import('@/pages/app/Tunnels'))
const Inspector = lazy(() => import('@/pages/app/Inspector'))
const Domains = lazy(() => import('@/pages/app/Domains'))
const Tokens = lazy(() => import('@/pages/app/Tokens'))
const Billing = lazy(() => import('@/pages/app/Billing'))
const Settings = lazy(() => import('@/pages/app/Settings'))

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } })

// Restores the session from the refresh cookie once per page load.
function Boot() {
  const ready = useAuth((s) => s.ready)
  useEffect(() => {
    refreshSession().finally(() => useAuth.getState().markReady())
  }, [])
  const loc = useLocation()
  if (!ready) return <div className="grid min-h-dvh place-items-center text-dust">Проверяем сессию…</div>
  // Only the top-level section (landing, auth, app) animates as a whole; nested
  // routes animate inside their own layouts.
  const section = loc.pathname.startsWith('/app') ? 'app' : ['/login', '/register', '/verify'].includes(loc.pathname) ? 'auth' : 'site'
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={section}
        initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }}
        animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }}
        exit={{ opacity: 0, transition: { duration: 0.2 } }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <Suspense fallback={<div className="min-h-dvh" />}>
          <Outlet />
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

function RequireAuth() {
  const user = useAuth((s) => s.user)
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return <Outlet />
}

function GuestOnly() {
  const user = useAuth((s) => s.user)
  return user ? <Navigate to="/app" replace /> : <Outlet />
}

const router = createBrowserRouter(
  [
    {
      element: <Boot />,
      children: [
        { path: '/', element: <Landing /> },
        {
          element: <GuestOnly />,
          children: [{ element: <AuthLayout />, children: ['login', 'register', 'verify'].map((p) => ({ path: p })) }],
        },
        {
          element: <RequireAuth />,
          children: [
            {
              path: 'app',
              element: <AppLayout />,
              children: [
                { index: true, element: <Overview /> },
                { path: 'tunnels', element: <Tunnels /> },
                { path: 'inspector', element: <Inspector /> },
                { path: 'domains', element: <Domains /> },
                { path: 'tokens', element: <Tokens /> },
                { path: 'billing', element: <Billing /> },
                { path: 'settings', element: <Settings /> },
              ],
            },
          ],
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <div className="grain">
        <RouterProvider router={router} />
      </div>
      <Toaster />
    </QueryClientProvider>
  )
}
