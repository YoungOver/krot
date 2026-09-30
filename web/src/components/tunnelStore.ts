import { create } from 'zustand'

// Kept apart from Tunnel3D so the landing can talk to the shaft without
// pulling three.js into the first chunk.

type TunnelStore = { packets: { id: number; born: number; lane: number }[]; fire: (n?: number) => void; speed: number; setSpeed: (v: number) => void }
let pid = 0
export const useTunnel = create<TunnelStore>((set) => ({
  packets: [],
  speed: 1,
  setSpeed: (speed) => set({ speed }),
  fire: (n = 1) =>
    set((s) => ({
      packets: [
        ...s.packets.filter((p) => performance.now() - p.born < 2200),
        ...Array.from({ length: n }, (_, i) => ({ id: ++pid, born: performance.now() + i * 140, lane: Math.random() * Math.PI * 2 })),
      ],
    })),
}))
