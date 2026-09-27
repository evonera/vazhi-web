import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles.css'
import './turnstile.css'
import { AuthProvider } from '@better-auth-ui/react'
import { authClient } from './lib/auth'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider authClient={authClient} navigate={({ to, replace }) => replace ? window.location.replace(to) : window.location.assign(to)}>
      <App />
    </AuthProvider>
  </StrictMode>,
)
