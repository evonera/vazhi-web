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
  PUBLIC_WEB_ORIGIN?: string
}

type PublicAsk = { slug: string; prompt: string; destination: string }
type PublicProfile = { handle: string; displayName?: string; bio?: string }
type PublicGuide = {
  handle: string
  title: string
  destination?: string
  subtitle?: string
  disclaimer?: string
  versionNumber: number
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function metadataText(value: unknown, fallback: string, maximumLength: number) {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maximumLength) : fallback
}

function publicOrigin(env: Env) {
  try {
    const configured = env.PUBLIC_WEB_ORIGIN ? new URL(env.PUBLIC_WEB_ORIGIN) : undefined
    return configured?.protocol === 'https:' ? configured.origin : 'https://vazhi.app'
  } catch {
    return 'https://vazhi.app'
  }
}

function metadata(input: { title: string; description: string; canonicalURL: string; imageURL?: string }) {
  const title = escapeHTML(metadataText(input.title, 'Vazhi', 160))
  const description = escapeHTML(metadataText(input.description, 'Capture places. Ask your people. Make the path.', 300))
  const canonicalURL = escapeHTML(input.canonicalURL)
  const image = input.imageURL
    ? `<meta property="og:image" content="${escapeHTML(input.imageURL)}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1920">`
    : ''
  return `<title>${title}</title><meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:url" content="${canonicalURL}">${image}<meta name="twitter:card" content="${input.imageURL ? 'summary_large_image' : 'summary'}"><link rel="canonical" href="${canonicalURL}">`
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

type SignedPublicIngressPath = '/api/recommendations' | '/api/reports' | '/places/search'

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
  const origin = publicOrigin(env)
  if (url.pathname === '/download') {
    return metadata({
      title: 'Download Vazhi for iPhone',
      description: 'Capture places, ask your people, and make a path with Vazhi. Android is coming soon.',
      canonicalURL: `${origin}/download`,
    })
  }

  const askMatch = url.pathname.match(/^\/ask\/([^/]+)$/)
  const profileMatch = url.pathname.match(/^\/@([a-z0-9_]{3,24})\/?$/i)
  const guideMatch = url.pathname.match(/^\/@([a-z0-9_]{3,24})\/([a-z0-9-]{3,64})\/?$/i)
  const convexOrigin = env.CONVEX_HTTP_URL?.replace(/\/$/, '')
  if (!convexOrigin || (!askMatch && !profileMatch && !guideMatch)) return ''

  try {
    if (askMatch) {
      const slug = askMatch[1]
      const response = await fetch(`${convexOrigin}/api/ask?slug=${encodeURIComponent(slug)}`)
      if (!response.ok) return ''
      const ask = await response.json() as PublicAsk
      return metadata({
        title: `${metadataText(ask.destination, 'Travel', 80)} · Ask the Way | Vazhi`,
        description: metadataText(ask.prompt, 'Recommend a place worth their time.', 200),
        canonicalURL: `${origin}/ask/${encodeURIComponent(slug)}`,
        imageURL: `${origin}/og/ask/${encodeURIComponent(slug)}`,
      })
    }

    if (guideMatch) {
      const [, handle, slug] = guideMatch
      const requestedVersion = url.searchParams.get('version')
      let versionQuery = ''
      let canonicalQuery = ''
      if (requestedVersion !== null) {
        const versionNumber = Number(requestedVersion)
        if (!Number.isSafeInteger(versionNumber) || versionNumber <= 0) return ''
        versionQuery = `&version=${encodeURIComponent(String(versionNumber))}`
        canonicalQuery = `?version=${encodeURIComponent(String(versionNumber))}`
      }
      const response = await fetch(`${convexOrigin}/api/listing?handle=${encodeURIComponent(handle)}&slug=${encodeURIComponent(slug)}${versionQuery}`)
      if (!response.ok) return ''
      const guide = await response.json() as PublicGuide
      const title = metadataText(guide.title, 'Vazhi guide', 120)
      const safeHandle = metadataText(guide.handle, handle, 24)
      const versionLabel = requestedVersion === null ? '' : ` · version ${guide.versionNumber}`
      return metadata({
        title: `${title}${versionLabel} · @${safeHandle} | Vazhi`,
        description: metadataText(guide.subtitle, metadataText(guide.disclaimer, metadataText(guide.destination, 'A versioned Vazhi guide.', 120), 220), 220),
        canonicalURL: `${origin}/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}${canonicalQuery}`,
      })
    }

    const handle = profileMatch![1]
    const response = await fetch(`${convexOrigin}/api/profile?handle=${encodeURIComponent(handle)}`)
    if (!response.ok) return ''
    const profile = await response.json() as PublicProfile
    const safeHandle = metadataText(profile.handle, handle, 24)
    const displayName = metadataText(profile.displayName, `@${safeHandle}`, 80)
    return metadata({
      title: `${displayName} · @${safeHandle} | Vazhi`,
      description: metadataText(profile.bio, 'Owner-approved, versioned travel guides on Vazhi.', 220),
      canonicalURL: `${origin}/@${encodeURIComponent(handle)}`,
    })
  } catch { return '' }
}

function withOGCache(response: Response) {
  if (!response.ok) return response
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'public, max-age=300, stale-while-revalidate=3600')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/recommendations') {
      return forwardSignedPublicIngress('/api/recommendations', request, env)
    }
    if (request.method === 'POST' && url.pathname === '/api/reports') {
      return forwardSignedPublicIngress('/api/reports', request, env)
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
    const supportsDynamicMetadata = url.pathname === '/download'
      || /^\/ask\/[^/]+$/.test(url.pathname)
      || /^\/@[a-z0-9_]{3,24}(?:\/[a-z0-9-]{3,64})?\/?$/i.test(url.pathname)
    if (wantsHTML && supportsDynamicMetadata) {
      const dynamicMetadata = await requestMetadata(url, env)
      if (dynamicMetadata) {
        const index = await env.ASSETS.fetch(new Request(new URL('/index.html', url)))
        const headers = new Headers(index.headers)
        headers.set('content-type', 'text/html; charset=utf-8')
        return new Response((await index.text()).replace(/<!-- vazhi:meta:start -->[\s\S]*?<!-- vazhi:meta:end -->/, dynamicMetadata), {
          status: index.status,
          statusText: index.statusText,
          headers,
        })
      }
    }

    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
    if (!wantsHTML) return asset
    const index = await env.ASSETS.fetch(new Request(new URL('/index.html', url)))
    return index
  },
}

export default worker
