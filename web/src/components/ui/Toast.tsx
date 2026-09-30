import { AnimatePresence, motion } from 'framer-motion'
import { create } from 'zustand'

type Toast = { id: number; text: string; tone: 'ok' | 'error' }
const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }))

let seq = 0
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: ++seq, text, tone }
  useToasts.setState((s) => ({ items: [...s.items, t] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((x) => x.id !== t.id) })), 3600)
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className={`rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
              t.tone === 'ok' ? 'border-signal/30 bg-clay/90 text-bone' : 'border-alarm/40 bg-clay/90 text-bone'
            }`}
          >
            <span className={`mr-2 inline-block size-2 rounded-full ${t.tone === 'ok' ? 'bg-signal' : 'bg-alarm'}`} />
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
