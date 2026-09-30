import { useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion'

// Scroll-driven explainer: the section pins while one request travels from a
// customer's phone to the developer's laptop. The path is a real sequence, so
// each stop lights up in order.

const stops = [
  { x: 110, y: 250, label: 'телефон', title: 'Телефон заказчика', text: 'Открывает https://shop.krot.dev. Для него это обычный сайт с валидным сертификатом.' },
  { x: 420, y: 110, label: 'узел spb-2', title: 'Узел Крота в Петербурге', text: 'Завершает TLS, смотрит на поддомен и находит, чей это туннель. Задержка до узла около 4 мс.' },
  { x: 760, y: 300, label: 'туннель', title: 'Туннель', text: 'Запрос уходит по уже открытому соединению вашего клиента. Входящих портов и белого IP не нужно.' },
  { x: 1070, y: 150, label: 'localhost:3000', title: 'Ваш ноутбук, порт 3000', text: 'Клиент передаёт запрос локальному серверу, ответ возвращается тем же путём. Всё видно в инспекторе.' },
]

const d = `M ${stops[0].x} ${stops[0].y} C 230 250, 300 110, ${stops[1].x} ${stops[1].y} S 640 300, ${stops[2].x} ${stops[2].y} S 950 150, ${stops[3].x} ${stops[3].y}`

function Stop({ i, progress }: { i: number; progress: MotionValue<number> }) {
  const at = i / (stops.length - 1)
  const lit = useTransform(progress, [at - 0.06, at], [0, 1])
  const s = stops[i]
  return (
    <g>
      <motion.circle cx={s.x} cy={s.y} r={28} fill="#ffb347" style={{ opacity: useTransform(lit, [0, 1], [0, 0.18]) }} />
      <circle cx={s.x} cy={s.y} r={13} fill="#241913" stroke="#3a2a20" strokeWidth={2} />
      <motion.circle cx={s.x} cy={s.y} r={7} fill="#ffb347" style={{ scale: lit, opacity: lit }} />
      <motion.text x={s.x} y={s.y + 52} textAnchor="middle" fontSize={20} fill="#efe6dc" style={{ opacity: useTransform(lit, [0, 1], [0.35, 1]) }}>
        {s.label}
      </motion.text>
    </g>
  )
}

export function Route() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 })
  const [active, setActive] = useState(0)
  useMotionValueEvent(progress, 'change', (v) => setActive(Math.min(stops.length - 1, Math.max(0, Math.round(v * (stops.length - 1))))))

  const pathRef = useRef<SVGPathElement>(null)
  const px = useTransform(progress, (v) => {
    const p = pathRef.current
    return p ? p.getPointAtLength(p.getTotalLength() * v).x : stops[0].x
  })
  const py = useTransform(progress, (v) => {
    const p = pathRef.current
    return p ? p.getPointAtLength(p.getTotalLength() * v).y : stops[0].y
  })

  return (
    <section ref={ref} className="relative h-[320vh]" aria-label="Путь запроса">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden px-5 md:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <h2 className="display max-w-3xl text-[clamp(2.2rem,5vw,4rem)]">Путь одного запроса</h2>
          <div className="relative mt-10">
            <svg viewBox="0 0 1180 380" className="w-full" role="img" aria-label="Схема: телефон, узел, туннель, ноутбук">
              <path d={d} fill="none" stroke="#3a2a20" strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />
              <motion.path ref={pathRef} d={d} fill="none" stroke="#ffb347" strokeWidth={3} strokeLinecap="round" style={{ pathLength: progress }} />
              {stops.map((_, i) => (
                <Stop key={i} i={i} progress={progress} />
              ))}
              <motion.circle r={9} fill="#3ee6c1" style={{ cx: px, cy: py }} />
              <motion.circle r={22} fill="#3ee6c1" opacity={0.18} style={{ cx: px, cy: py }} />
            </svg>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
            <span className="display text-6xl text-lamp tabular-nums">{active + 1}/4</span>
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="max-w-xl">
                <h3 className="text-2xl font-semibold">{stops[active].title}</h3>
                <p className="mt-2 text-lg leading-relaxed text-bone/70">{stops[active].text}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
