import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: process.env.KROT_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:8081' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\/](three|@react-three)/.test(id)) return 'three'
          if (/node_modules[\/](recharts|d3-)/.test(id)) return 'charts'
        },
      },
    },
  },
  test: { environment: 'jsdom', globals: true },
})
