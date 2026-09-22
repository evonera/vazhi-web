import { edgeIngressSignature } from './lib/edgeIngressSignature'
import { opaqueRateLimitKey } from './lib/publicIngress'

interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  ASSETS: AssetFetcher
  CONVEX_HTTP_URL?: string
  EDGE_INGRESS_SIGNING_SECRET?: string
  RATE_LIMIT_SALT?: string
  TURNSTILE_SECRET_KEY?: string
  VAZHI_ENVIRONMENT?: string
  IOS_APP_STORE_URL?: string
  PUBLIC_WEB_ORIGIN?: string
}

type PublicAsk = { slug: string; prompt: string; destination: string }
type PublicGuide = { handle: string; title: string; subtitle?: string; disclaimer?: string }

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function publicOrigin(url: URL, env: Env) {
  try {
    const configured = env.PUBLIC_WEB_ORIGIN ? new URL(env.PUBLIC_WEB_ORIGIN) : undefined
    return configured?.protocol === 'https:' ? configured.origin : url.origin
  } catch {
    return url.origin
  }
}

function metadata(title: string, description: string, image?: string) {
  const safeTitle = escapeHTML(title)
  const safeDescription = escapeHTML(description)
  const imageTags = image
    ? `<meta property="og:image" content="${escapeHTML(image)}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1920">`
    : ''
  return `<title>${safeTitle}</title><meta name="description" content="${safeDescription}"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}"><meta property="og:type" content="website">${imageTags}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`
}

async function requestMetadata(url: URL, env: Env) {
  const askMatch = url.pathname.match(/^\/ask\/([^/]+)$/)
  const guideMatch = url.pathname.match(/^\/@([a-z0-9_]{3,24})\/([a-z0-9-]{3,64})\/?$/i)
  const convexOrigin = env.CONVEX_HTTP_URL?.replace(/\/$/, '')
  if (!convexOrigin || (!askMatch && !guideMatch)) return ''
  try {
    if (askMatch) {
      const response = await fetch(`${convexOrigin}/api/ask?slug=${encodeURIComponent(askMatch[1])}`)
      if (!response.ok) return ''
      const ask = await response.json() as PublicAsk
      return metadata(`${ask.destination} · Ask the Way | Vazhi`, ask.prompt, `${publicOrigin(url, env)}/og/ask/${encodeURIComponent(ask.slug)}`)
    }

    const response = await fetch(`${convexOrigin}/api/listing?handle=${encodeURIComponent(guideMatch![1])}&slug=${encodeURIComponent(guideMatch![2])}`)
    if (!response.ok) return ''
    const guide = await response.json() as PublicGuide
    return metadata(`${guide.title} · @${guide.handle} | Vazhi`, guide.subtitle ?? guide.disclaimer ?? 'A versioned Vazhi guide.')
  } catch { return '' }
}

function withOGCache(response: Response) {
  if (!response.ok) return response
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'public, max-age=300, stale-while-revalidate=3600')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

async function turnstilePasses(input: Record<string, unknown>, request: Request, env: Env) {
  if (!env.TURNSTILE_SECRET_KEY) return env.VAZHI_ENVIRONMENT === 'development'
  const token = typeof input.turnstileToken === 'string' ? input.turnstileToken : undefined
  if (!token) return false
  const form = new FormData()
  form.set('secret', env.TURNSTILE_SECRET_KEY)
  form.set('response', token)
  const remoteIP = request.headers.get('cf-connecting-ip')
  if (remoteIP) form.set('remoteip', remoteIP)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  return (await response.json() as { success?: boolean }).success === true
}

type SignedPublicIngressPath = '/api/recommendations' | '/api/reports' | '/places/search'

async function forwardSignedPublicIngress(path: SignedPublicIngressPath, request: Request, env: Env) {
  if (!env.CONVEX_HTTP_URL) return json({ message: 'This request is unavailable.' }, 503)
  const rawBody = await request.text()
  let input: Record<string, unknown>
  try { input = JSON.parse(rawBody) as Record<string, unknown> } catch { return json({ message: 'Check the form and try again.' }, 400) }
  // Searching must remain frictionless while someone is choosing a place.
  // Recommendation and report submission still require Turnstile.
  if (path !== '/places/search' && !await turnstilePasses(input, request, env)) {
    return json({ message: 'Please complete the verification and try again.' }, 400)
  }
  if ((!env.EDGE_INGRESS_SIGNING_SECRET || !env.RATE_LIMIT_SALT) && env.VAZHI_ENVIRONMENT !== 'development') return json({ message: 'This request is unavailable.' }, 503)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (env.EDGE_INGRESS_SIGNING_SECRET) headers.set('x-vazhi-edge-signature', await edgeIngressSignature(rawBody, env.EDGE_INGRESS_SIGNING_SECRET))
  if (env.RATE_LIMIT_SALT) headers.set('x-vazhi-rate-key', await opaqueRateLimitKey(request.headers.get('cf-connecting-ip'), env.RATE_LIMIT_SALT))
  const response = await fetch(`${env.CONVEX_HTTP_URL.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: rawBody })
  return new Response(response.body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } })
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (request.method === 'POST' && (url.pathname === '/api/recommendations' || url.pathname === '/api/reports')) {
      return forwardSignedPublicIngress(url.pathname, request, env)
    }
    if (request.method === 'POST' && url.pathname === '/places/search') {
      return forwardSignedPublicIngress('/places/search', request, env)
    }
    if (url.pathname === '/download' && request.method === 'GET') {
      const userAgent = request.headers.get('user-agent') ?? ''
      if (/iPhone|iPad|iPod/i.test(userAgent) && env.IOS_APP_STORE_URL?.startsWith('https://')) {
        return Response.redirect(env.IOS_APP_STORE_URL, 302)
      }
    }
    if (url.pathname.match(/^\/og\/ask\/[^/]+$/)) {
      const slug = url.pathname.split('/').at(-1) ?? ''
      if (!env.CONVEX_HTTP_URL) return new Response('Not configured', { status: 503 })
      const response = await fetch(`${env.CONVEX_HTTP_URL.replace(/\/$/, '')}/og/ask?slug=${encodeURIComponent(slug)}`)
      return withOGCache(response)
    }
    const wantsHTML = request.method === 'GET' && request.headers.get('accept')?.includes('text/html')
    const supportsDynamicMetadata = /^\/ask\/[^/]+$/.test(url.pathname) || /^\/@[a-z0-9_]{3,24}\/[a-z0-9-]{3,64}\/?$/i.test(url.pathname)
    if (wantsHTML && supportsDynamicMetadata) {
      const meta = await requestMetadata(url, env)
      if (meta) {
        const index = await env.ASSETS.fetch(new Request(new URL('/index.html', url)))
        return new Response((await index.text()).replace(/<!-- vazhi:meta:start -->[\s\S]*?<!-- vazhi:meta:end -->/, meta), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
    }

    return env.ASSETS.fetch(request)
  },
}

export default worker
