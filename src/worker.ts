interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  ASSETS: AssetFetcher
  CONVEX_HTTP_URL?: string
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
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'public, max-age=300, stale-while-revalidate=3600')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
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
