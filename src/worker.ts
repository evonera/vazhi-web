import { edgeIngressSignature } from './lib/edgeIngressSignature'
import { mayBypassTurnstile, opaqueRateLimitKey } from './lib/publicIngress'

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
}

type PublicAsk = { slug: string; prompt: string; destination: string }

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

async function turnstilePasses(input: Record<string, unknown>, request: Request, env: Env) {
  if (mayBypassTurnstile(env.VAZHI_ENVIRONMENT, env.TURNSTILE_SECRET_KEY)) return true
  if (!env.TURNSTILE_SECRET_KEY) return false
  const token = typeof input.turnstileToken === 'string' ? input.turnstileToken : undefined
  if (!token) return false
  const form = new FormData()
  form.set('secret', env.TURNSTILE_SECRET_KEY)
  form.set('response', token)
  const remoteIP = request.headers.get('cf-connecting-ip')
  if (remoteIP) form.set('remoteip', remoteIP)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  return (await response.json() as { success?: boolean }).success === true
}

type SignedPublicIngressPath = '/api/recommendations' | '/places/search'

async function forwardSignedPublicIngress(
  path: SignedPublicIngressPath,
  request: Request,
  env: Env,
) {
  if (!env.CONVEX_HTTP_URL) return json({ message: 'This request is unavailable.' }, 503)
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
    return json({ message: 'This request is too large.' }, 413)
  }
  let input: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawBody) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid input')
    input = parsed as Record<string, unknown>
  } catch {
    return json({ message: 'Check the form and try again.' }, 400)
  }

  // Place type-ahead remains frictionless. The eventual submission must pass
  // Turnstile, and both routes remain edge-signed and independently limited.
  if (path === '/api/recommendations' && !await turnstilePasses(input, request, env)) {
    return json({ message: 'Please complete the verification and try again.' }, 400)
  }
  const isDevelopment = env.VAZHI_ENVIRONMENT === 'development'
  if ((!env.EDGE_INGRESS_SIGNING_SECRET || !env.RATE_LIMIT_SALT) && !isDevelopment) {
    return json({ message: 'This request is unavailable.' }, 503)
  }

  const headers = new Headers({ 'content-type': 'application/json' })
  if (env.EDGE_INGRESS_SIGNING_SECRET) {
    headers.set(
      'x-vazhi-edge-signature',
      await edgeIngressSignature(rawBody, env.EDGE_INGRESS_SIGNING_SECRET),
    )
  }
  if (env.RATE_LIMIT_SALT) {
    headers.set(
      'x-vazhi-rate-key',
      await opaqueRateLimitKey(request.headers.get('cf-connecting-ip'), env.RATE_LIMIT_SALT),
    )
  }
  const origin = env.CONVEX_HTTP_URL.replace(/\/$/, '')
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers, body: rawBody })
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  })
}

async function requestMetadata(url: URL, env: Env) {
  const match = url.pathname.match(/^\/ask\/([^/]+)$/)
  if (!match || !env.CONVEX_HTTP_URL) return ''
  try {
    const response = await fetch(`${env.CONVEX_HTTP_URL}/api/ask?slug=${encodeURIComponent(match[1])}`)
    if (!response.ok) return ''
    const ask = await response.json() as PublicAsk
    const title = escapeHTML(`${ask.destination} · Ask the Way | Vazhi`)
    const description = escapeHTML(ask.prompt)
    const image = `${url.origin}/og/ask/${encodeURIComponent(ask.slug)}`
    return `<title>${title}</title><meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1920"><meta name="twitter:card" content="summary_large_image">`
  } catch { return '' }
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/recommendations') {
      return forwardSignedPublicIngress('/api/recommendations', request, env)
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
      return fetch(`${env.CONVEX_HTTP_URL}/og/ask?slug=${encodeURIComponent(slug)}`)
    }
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
    if (request.method !== 'GET' || !request.headers.get('accept')?.includes('text/html')) return asset
    const index = await env.ASSETS.fetch(new Request(new URL('/index.html', url)))
    const meta = await requestMetadata(url, env)
    if (!meta) return index
    return new Response((await index.text()).replace('<!-- vazhi:meta -->', meta), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
}

export default worker
