import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/index.css'

async function start() {
  // Without VITE_REAL_API=1 the API is served by a service worker inside the
  // browser, so the static demo on GitHub Pages works with no backend.
  if (import.meta.env.VITE_REAL_API !== '1') {
    const { setupWorker } = await import('msw/browser')
    const { handlers } = await import('./mocks/handlers')
    await setupWorker(...handlers).start({
      onUnhandledRequest: 'bypass',
      quiet: true,
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    })
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

start()
