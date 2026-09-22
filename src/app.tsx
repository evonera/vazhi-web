import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  categoryLabel,
  type Place,
  type PublicAskRequest,
  recommendationCategories,
  type RecommendationCategory,
} from './lib/contracts'
import { publicAskAPI } from './lib/api'
import { getConvexAccessToken, startAppleSignIn } from './lib/auth'

const demoRequest: PublicAskRequest = {
  slug: 'demo-malaysia',
  prompt: 'Going to Malaysia in November — where should I go?',
  destination: 'Malaysia',
  journeyTitle: 'Malaysia in November',
  status: 'open',
}

function currentSlug(): string | null {
  const match = window.location.pathname.match(/^\/ask\/([^/]+)$/)
  return match?.[1] ?? null
}

export function App() {
  const slug = currentSlug()
  if (slug) return <AskPage slug={slug} />
  if (window.location.pathname === '/privacy') return <LegalPage title="Privacy" />
  if (window.location.pathname === '/terms') return <LegalPage title="Terms" />
  if (window.location.pathname === '/report') return <LegalPage title="Report a link" />
  if (window.location.pathname === '/sign-in') return <SignInPage />
  if (window.location.pathname === '/requests') return <RequestsPage />
  return <LandingPage />
}

function LandingPage() {
  return (
    <main className="landing shell">
      <p className="eyebrow">Vazhi · Ask the Way</p>
      <h1>Capture places.<br />Ask your people.<br />Make the path.</h1>
      <p className="lede">Vazhi turns trusted recommendations from your audience into a private, editable travel path.</p>
      <a className="button" href="/ask/demo-malaysia">Try the Malaysia request</a>
      <p className="fine-print">A story-link demo. No app download needed to recommend a place.</p>
    </main>
  )
}

function AskPage({ slug }: { slug: string }) {
  const [request, setRequest] = useState<PublicAskRequest | null>(slug === 'demo-malaysia' ? demoRequest : null)
  const [loading, setLoading] = useState(slug !== 'demo-malaysia')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (slug === 'demo-malaysia') return
    publicAskAPI.getRequest(slug)
      .then(setRequest)
      .catch((receivedError: Error) => setError(receivedError.message))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <main className="shell centered"><p>Opening Vazhi request…</p></main>
  if (error || !request) return <main className="shell centered"><h1>This request is unavailable.</h1><p>{error ?? 'Ask the owner for a new link.'}</p></main>
  if (request.status === 'closed') return <main className="shell centered"><p className="eyebrow">Vazhi</p><h1>This request is closed.</h1><p>The owner has stopped accepting recommendations. Their path is still private.</p></main>

  return <main className="ask shell"><AskHeader request={request} /><RecommendationForm request={request} demo={slug === 'demo-malaysia'} /></main>
}

function AskHeader({ request }: { request: PublicAskRequest }) {
  return <header className="ask-header">
    <a className="wordmark" href="/">Vazhi</a>
    <p className="eyebrow">Ask the Way</p>
    <h1>{request.prompt}</h1>
    <p className="destination">For {request.destination}</p>
    <p className="lede">Know somewhere worth their time? Add one place and tell them why.</p>
  </header>
}

function RecommendationForm({ request, demo }: { request: PublicAskRequest; demo: boolean }) {
  const [anonymous, setAnonymous] = useState(false)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [category, setCategory] = useState<RecommendationCategory>('food')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [note, setNote] = useState('')
  const [referenceURL, setReferenceURL] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (query.trim().length < 3 || selectedPlace) {
      setResults([])
      return
    }
    const timeout = window.setTimeout(() => {
      if (demo) {
        setResults([{ provider: 'google', providerPlaceID: 'demo-village-park', name: 'Village Park Restaurant', address: 'Damansara Utama, Petaling Jaya, Malaysia', latitude: 3.136, longitude: 101.619, primaryType: 'restaurant' }])
      } else {
        publicAskAPI.searchPlaces(query, request.destination).then(setResults).catch(() => setResults([]))
      }
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [demo, query, request.destination, selectedPlace])

  const canSubmit = Boolean(selectedPlace && note.trim() && (anonymous || name.trim()) && status !== 'submitting')
  const placeLabel = useMemo(() => selectedPlace ? [selectedPlace.name, selectedPlace.address].filter(Boolean).join(' · ') : '', [selectedPlace])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPlace || !note.trim() || (!anonymous && !name.trim())) return
    setError(null)
    setStatus('submitting')
    try {
      if (!demo) {
        await publicAskAPI.submit(request.slug, {
          anonymous,
          contributorName: anonymous ? undefined : name.trim(),
          contributorHandle: handle.trim() || undefined,
          category,
          place: selectedPlace,
          note: note.trim(),
          referenceURL: referenceURL.trim() || undefined,
        })
      }
      setStatus('success')
    } catch (receivedError) {
      setError(receivedError instanceof Error ? receivedError.message : 'Please try again.')
      setStatus('idle')
    }
  }

  if (status === 'success') return <section className="success" aria-live="polite"><p className="eyebrow">Sent</p><h2>That’s on their path.</h2><p>Your recommendation stays private to the trip owner until they choose what to use.</p><a className="text-link" href="/">Make your own Vazhi request</a></section>

  return <form className="recommendation-form" onSubmit={submit}>
    <fieldset><legend>Who are you?</legend>
      <label className="checkbox"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> Submit anonymously</label>
      {!anonymous && <label>Your first name<input required maxLength={40} autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
      <label>Instagram handle <span className="optional">optional</span><input maxLength={50} placeholder="@yourhandle" value={handle} onChange={(event) => setHandle(event.target.value)} /></label>
    </fieldset>
    <fieldset><legend>What should they know?</legend>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as RecommendationCategory)}>{recommendationCategories.map((item) => <option key={item} value={item}>{categoryLabel[item]}</option>)}</select></label>
      <label>Find a place<input required value={selectedPlace ? placeLabel : query} placeholder={`Search in ${request.destination}`} onChange={(event) => { setSelectedPlace(null); setQuery(event.target.value) }} /></label>
      {results.length > 0 && <div className="results" role="listbox" aria-label="Place results">{results.map((place) => <button key={`${place.provider}-${place.providerPlaceID ?? place.name}`} type="button" onClick={() => { setSelectedPlace(place); setResults([]) }}><strong>{place.name}</strong><span>{place.address}</span></button>)}</div>}
      {selectedPlace && <button type="button" className="clear-place" onClick={() => { setSelectedPlace(null); setQuery('') }}>Change selected place</button>}
      <label>Or drop a pin <span className="optional">latitude, longitude</span><input placeholder="3.1390, 101.6869" onBlur={(event) => {
        if (selectedPlace || !event.target.value.trim()) return
        const [latitude, longitude] = event.target.value.split(',').map(Number)
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) setSelectedPlace({ provider: 'manual', name: 'Pinned place', latitude, longitude })
      }} /></label>
      <label>Why is it worth it?<textarea required maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should they order, notice, or avoid?" /></label>
      <label>Reference link <span className="optional">optional, https only</span><input type="url" placeholder="https://…" value={referenceURL} onChange={(event) => setReferenceURL(event.target.value)} /></label>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button" disabled={!canSubmit} type="submit">{status === 'submitting' ? 'Sending…' : 'Add to their path'}</button>
    <p className="fine-print">Recommendations are private to this trip owner. Do not submit someone’s home or sensitive location.</p>
  </form>
}

function SignInPage() {
  const [error, setError] = useState<string | null>(null)
  return <main className="shell centered"><p className="eyebrow">Owner access</p><h1>Sign in on Vazhi.</h1><p>Use Apple to manage links you created. Audience members never need an account.</p><button className="button" onClick={() => startAppleSignIn().catch((reason: Error) => setError(reason.message))}>Continue with Apple</button>{error && <p className="form-error" role="alert">{error}</p>}</main>
}

type OwnerRequest = { id: string; slug: string; prompt: string; destination: string; status: 'open' | 'closed'; recommendationCount: number }

function RequestsPage() {
  const [requests, setRequests] = useState<OwnerRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const token = await getConvexAccessToken()
      const base = import.meta.env.VITE_CONVEX_HTTP_URL as string
      const response = await fetch(`${base}/api/owner/ask-requests`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Your requests are unavailable.')
      setRequests(await response.json() as OwnerRequest[])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in to view your requests.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  async function closeRequest(requestID: string) {
    try {
      const token = await getConvexAccessToken()
      const base = import.meta.env.VITE_CONVEX_HTTP_URL as string
      const response = await fetch(`${base}/api/owner/ask-requests`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ requestID, status: 'closed' }) })
      if (!response.ok) throw new Error('The link could not be closed.')
      setRequests((current) => current.map((item) => item.id === requestID ? { ...item, status: 'closed' } : item))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The link could not be closed.') }
  }

  if (loading) return <main className="shell centered"><p>Loading your requests…</p></main>
  if (error && requests.length === 0) return <main className="shell centered"><p className="eyebrow">Owner access</p><h1>Sign in to see your requests.</h1><p>{error}</p><a className="button" href="/sign-in">Continue with Apple</a></main>
  return <main className="shell"><a className="wordmark" href="/">Vazhi</a><p className="eyebrow">Ask the Way</p><h1>Your requests</h1><p className="lede">Your iPhone remains the home for accepting recommendations and building a Path.</p>{error && <p className="form-error" role="alert">{error}</p>}<section className="request-list" aria-label="Your Ask the Way requests">{requests.length === 0 ? <p>No requests yet. Create one from a Journey in Vazhi.</p> : requests.map((request) => <article className="request-card" key={request.id}><p className="status"><span aria-hidden="true">{request.status === 'open' ? '●' : '○'}</span> {request.status}</p><h2>{request.destination}</h2><p>{request.prompt}</p><p className="fine-print">{request.recommendationCount} recommendation{request.recommendationCount === 1 ? '' : 's'} · <a href={`/ask/${request.slug}`}>Open public link</a></p>{request.status === 'open' && <button className="text-link" onClick={() => void closeRequest(request.id)}>Close link</button>}</article>)}</section></main>
}
function LegalPage({ title }: { title: string }) { return <main className="shell legal"><a className="wordmark" href="/">Vazhi</a><h1>{title}</h1><p>Vazhi is private by default. Shared Ask the Way links expose only the prompt and destination. Recommendations are visible only to the request owner.</p><p>Do not submit private addresses, sensitive locations, or material you do not have permission to share.</p></main> }
