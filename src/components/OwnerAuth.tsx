import { useEffect, useState, type FormEvent } from 'react'
import { useSignInEmail, useSignUpEmail, useSignInSocial, useSession, useRequestPasswordReset, useResetPassword, useLinkSocial, useSignOut, useListAccounts } from '@better-auth-ui/react'
import { authClient } from '../lib/auth'

type Capabilities = Record<'email' | 'apple' | 'google' | 'discord', boolean>
const unavailable: Capabilities = { email: false, apple: false, google: false, discord: false }
const providers = ['apple', 'google', 'discord'] as const
const names = { apple: 'Apple', google: 'Google', discord: 'Discord' }

function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    fetch('/api/owner/auth-capabilities', { signal: abort.signal }).then(async r => {
      if (!r.ok) throw new Error('Unavailable')
      const input = await r.json() as Record<string, unknown>
      setCapabilities(Object.fromEntries(Object.keys(unavailable).map(key => [key, input[key] === true])) as Capabilities)
    }).catch(() => { if (!abort.signal.aborted) { setFailed(true); setCapabilities(unavailable) } })
    return () => abort.abort()
  }, [])
  return { capabilities, failed }
}

// Preserve only a validated native context; never accept arbitrary return URLs.
export function nativeAuthContext(search = window.location.search) {
  const params = new URLSearchParams(search)
  const challenge = params.get('nativeChallenge') ?? ''
  const state = params.get('state') ?? ''
  return /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^[A-Za-z0-9_-]{43}$/.test(state) ? { challenge, state } : null
}

export function OwnerSignInPage() {
  const { capabilities, failed } = useCapabilities()
  const session = useSession(authClient)
  const signIn = useSignInEmail(authClient)
  const signUp = useSignUpEmail(authClient)
  const social = useSignInSocial(authClient)
  const forgot = useRequestPasswordReset(authClient)
  const reset = useResetPassword(authClient)
  const signOut = useSignOut(authClient)
  const resetToken = new URLSearchParams(window.location.search).get('token')
  const native = nativeAuthContext()
  const [mode, setMode] = useState<'in' | 'up' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'in')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [finishing, setFinishing] = useState(false)
  const callbackURL = new URL(native ? `/sign-in?nativeChallenge=${native.challenge}&state=${native.state}` : '/requests', window.location.origin).href
  const pending = signIn.isPending || signUp.isPending || social.isPending || forgot.isPending || reset.isPending || finishing || signOut.isPending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    try {
      if (mode === 'up') {
        await signUp.mutateAsync({ email, password, name: String(form.get('name') ?? '').trim(), callbackURL })
        setMessage('Check your email to verify your address, then sign in.'); setMode('in')
      } else if (mode === 'forgot') {
        await forgot.mutateAsync({ email, redirectTo: new URL('/sign-in', window.location.origin).href })
        setMessage('If this address has an account, a password-reset email will arrive shortly.')
      } else if (mode === 'reset') {
        await reset.mutateAsync({ token: resetToken ?? '', newPassword: password })
        setMessage('Password changed. Sign in with your new password.'); setMode('in')
      } else {
        await signIn.mutateAsync({ email, password })
        if (!native) window.location.assign('/requests')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed. Please try again.') }
  }
  async function finishNative() {
    if (!native) return
    setFinishing(true); setError('')
    try {
      const response = await fetch('/api/native/authorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: native.challenge }) })
      const body = await response.json() as { code?: string; message?: string }
      if (!response.ok || !body.code || !/^[A-Za-z0-9_-]{43}$/.test(body.code)) throw new Error(body.message ?? 'Could not connect Vazhi.')
      window.location.assign(`com.evonera.vazhi://auth/callback?code=${encodeURIComponent(body.code)}&state=${encodeURIComponent(native.state)}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Try signing in again.') }
    finally { setFinishing(false) }
  }
  return <main className="route-page route-page--centered owner-auth"><a className="wordmark" href="/">vazhi.</a><p className="eyebrow">Your private travel space</p><h1>{mode === 'up' ? 'Make room for your next adventure.' : mode === 'forgot' || mode === 'reset' ? 'Reset your password.' : 'Welcome back.'}</h1><p>Capture locally without an account. Sign in to sync, share links, and receive your people’s recommendations.</p>
    {session.data && native ? <section><p>Signed in as {session.data.user.email}.</p><button className="button" disabled={pending} onClick={() => void finishNative()}>Continue to Vazhi</button><button className="text-link" disabled={pending} onClick={() => signOut.mutateAsync({}).then(() => window.location.reload()).catch(() => setError('Could not sign out. Try again.'))}>Use another account / sign in again</button></section> : <>
      {capabilities === null ? <p role="status">Checking sign-in options…</p> : <>
        <form onSubmit={submit} className="owner-auth__form"><fieldset disabled={!capabilities.email || pending}><legend>Email {mode === 'up' ? 'sign-up' : 'sign-in'}</legend>
          {mode === 'up' && <label>Your name<input name="name" required maxLength={80} autoComplete="name" /></label>}
          {mode !== 'reset' && <label>Email<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>}
          {mode !== 'forgot' && <label>Password<input type="password" name="password" required minLength={mode === 'in' ? undefined : 12} maxLength={128} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>}
          <button className="button" disabled={pending || !capabilities.email}>{pending ? 'Please wait…' : mode === 'up' ? 'Create account' : mode === 'forgot' ? 'Send reset email' : mode === 'reset' ? 'Set new password' : 'Sign in with email'}</button></fieldset>
          {!capabilities.email && <p className="fine-print">Email sign-in is awaiting secure email-service configuration.</p>}
        </form>
        <div className="owner-auth__links"><button className="text-link" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setError(''); setMessage('') }}>{mode === 'up' ? 'Already have an account?' : 'Create an account'}</button><button className="text-link" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Forgot password?</button></div>
        <div className="owner-auth__providers">{providers.map(provider => <button key={provider} className="button" disabled={pending || !capabilities[provider]} onClick={() => { setError(''); social.mutateAsync({ provider, callbackURL, errorCallbackURL: callbackURL }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not sign in.')) }}>Continue with {names[provider]}{!capabilities[provider] && <span className="fine-print"> · Not configured yet</span>}</button>)}</div>
      </>}
    </>}
    {failed && <p role="alert">Sign-in service is unavailable. Your local journal is unaffected.</p>}{message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<p className="fine-print">Audience members never need an account. By continuing, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
  </main>
}

export function OwnerAccountControls() {
  const session = useSession(authClient)
  const accounts = useListAccounts(authClient)
  const link = useLinkSocial(authClient)
  const signOut = useSignOut(authClient)
  const { capabilities } = useCapabilities()
  const [error, setError] = useState('')
  if (!session.data) return null
  return <section className="owner-auth__account" aria-label="Your account"><p>{session.data.user.email}</p><p className="fine-print">Link other methods while signed in to keep one account, including Apple’s private relay address. Don’t create separate accounts for each provider.</p>
    {providers.map(provider => {
      const linked = accounts.data?.some(account => account.providerId === provider)
      return <button className="text-link" key={provider} disabled={accounts.isPending || !capabilities?.[provider] || linked || link.isPending} onClick={() => link.mutateAsync({ provider, callbackURL: new URL('/requests', window.location.origin).href }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not link account.'))}>{linked ? `${names[provider]} linked` : `Link ${names[provider]}`}</button>
    })}<button className="text-link" disabled={signOut.isPending} onClick={() => signOut.mutateAsync({}).then(() => window.location.assign('/sign-in')).catch(() => setError('Could not sign out.'))}>Sign out</button>{error && <p role="alert">{error}</p>}</section>
}
