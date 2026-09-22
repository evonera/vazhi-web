import { useEffect, useRef, useState } from 'react'

type TurnstileAPI = {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'error-callback': () => void; 'expired-callback': () => void }) => string
  remove: (widgetID: string) => void
}

declare global { interface Window { turnstile?: TurnstileAPI } }
const scriptID = 'cloudflare-turnstile'

/** Client widget only; the Cloudflare Worker verifies its token server-side. */
export function TurnstileField({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const widgetID = useRef<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) { setMessage('Safety verification is not configured for this link yet.'); return }
    let cancelled = false
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widgetID.current) return
      widgetID.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: (token) => { setMessage(null); onToken(token) },
        'error-callback': () => { onToken(null); setMessage('Safety verification did not load. Please try again.') },
        'expired-callback': () => { onToken(null); setMessage('Safety verification expired. Please complete it again.') },
      })
    }
    const existing = document.getElementById(scriptID) as HTMLScriptElement | null
    if (existing) { if (window.turnstile) render(); else existing.addEventListener('load', render, { once: true }) }
    else {
      const script = document.createElement('script')
      script.id = scriptID; script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true
      script.addEventListener('load', render, { once: true })
      script.addEventListener('error', () => setMessage('Safety verification did not load. Please try again.'), { once: true })
      document.head.appendChild(script)
    }
    return () => { cancelled = true; if (widgetID.current && window.turnstile) window.turnstile.remove(widgetID.current); widgetID.current = null }
  }, [onToken, siteKey])

  return <div className="turnstile-field"><div ref={container} /><p aria-live="polite">{message ?? 'Complete the safety check to send your recommendation.'}</p></div>
}
