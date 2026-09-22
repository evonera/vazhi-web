interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  ASSETS: AssetFetcher
  CONVEX_HTTP_URL?: string
  IOS_APP_STORE_URL?: string
}

type PublicAsk = { slug: string; prompt: string; destination: string }

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
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
