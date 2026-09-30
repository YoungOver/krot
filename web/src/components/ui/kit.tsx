import { AnimatePresence, motion } from 'framer-motion'
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'lamp' | 'ghost' | 'danger'; busy?: boolean }

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'lamp', busy, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={clsx(
        'relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-full px-6 text-[15px] font-semibold transition-[transform,background-color,color] duration-200 active:scale-[0.97] disabled:opacity-60',
        variant === 'lamp' && 'bg-lamp text-soil hover:bg-[#ffc46e]',
        variant === 'ghost' && 'border border-seam text-bone hover:border-dust hover:bg-clay',
        variant === 'danger' && 'bg-alarm/15 text-alarm hover:bg-alarm/25',
        className,
      )}
      {...rest}
    >
      <span className={clsx('inline-flex items-center gap-2 transition-opacity', busy && 'opacity-0')}>{children}</span>
      {busy && <span className="absolute size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
    </button>
  )
})

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, id, className, ...rest }, ref) {
  const fid = id ?? rest.name
  return (
    <label htmlFor={fid} className={clsx('block', className)}>
      <span className="mb-1.5 block text-sm text-dust">{label}</span>
      <input
        ref={ref}
        id={fid}
        aria-invalid={!!error}
        className={clsx(
          'h-12 w-full rounded-xl border bg-soil/60 px-4 text-bone placeholder:text-dust/60 transition-colors outline-none focus:border-lamp',
          error ? 'border-alarm' : 'border-seam',
        )}
        {...rest}
      />
      <AnimatePresence initial={false}>
        {(error || hint) && (
          <motion.span
            key={error ? 'e' : 'h'}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={clsx('mt-1.5 block text-sm', error ? 'text-alarm' : 'text-dust')}
          >
            {error ?? hint}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  )
})

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-soil/80 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 30, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="relative w-full max-w-lg rounded-3xl border border-seam bg-clay p-7 shadow-[0_40px_120px_-30px_rgba(0,0,0,.8)]"
          >
            <h2 className="display mb-5 text-2xl">{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#241913" stroke="#3a2a20" />
        <circle cx="16" cy="16" r="9" fill="none" stroke="#ffb347" strokeWidth="1.5" opacity=".45" />
        <circle cx="16" cy="16" r="4.5" fill="#ffb347" />
      </svg>
      <span className="display text-xl tracking-tight">крот</span>
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-clay-2', className)} />
}

export function StatusDot({ status }: { status: 'online' | 'paused' | 'offline' | 'pending' | 'active' }) {
  const on = status === 'online' || status === 'active'
  return (
    <span className="relative inline-flex size-2.5">
      {on && <span className="absolute inset-0 animate-ping rounded-full bg-signal/60" />}
      <span className={clsx('relative size-2.5 rounded-full', on ? 'bg-signal' : status === 'paused' || status === 'pending' ? 'bg-lamp' : 'bg-dust')} />
    </span>
  )
}
