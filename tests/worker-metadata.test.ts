import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/worker'

const document = '<!doctype html><html><head><!-- vazhi:meta:start --><title>Default Vazhi</title><!-- vazhi:meta:end --></head><body>Vazhi</body></html>'

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {
      fetch: async (request) => new URL(request.url).pathname === '/index.html'
        ? new Response(document, { headers: { 'content-type': 'text/html' } })
        : new Response('not found', { status: 404 }),
    },
    CONVEX_HTTP_URL: 'https://vazhi.convex.site/',
    PUBLIC_WEB_ORIGIN: 'https://vazhi.app',
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('public campaign metadata', () => {
  it('fetches and labels the exact immutable guide version from the URL', async () => {
    let upstreamURL = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      upstreamURL = String(input)
      return new Response(JSON.stringify({
        handle: 'asha',
        title: 'Penang on foot · first edition',
        destination: 'George Town, Malaysia',
        subtitle: 'A gentle old-town route.',
        disclaimer: 'Traveler notes; verify details before visiting.',
        versionNumber: 2,
      }))
    }))

    const response = await worker.fetch(new Request('https://preview.example/@asha/penang-walk?version=2', {
      headers: { accept: 'text/html' },
    }), environment())
    const html = await response.text()

    expect(upstreamURL).toBe('https://vazhi.convex.site/api/listing?handle=asha&slug=penang-walk&version=2')
    expect(html).toContain('<title>Penang on foot · first edition · version 2 · @asha | Vazhi</title>')
    expect(html).toContain('<link rel="canonical" href="https://vazhi.app/@asha/penang-walk?version=2">')
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  it('escapes public profile and guide text before putting it in HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      handle: 'asha',
      displayName: '<script>alert(1)</script>',
      bio: 'Coastal walks & slow mornings "only".',
      listings: [],
    }))))

    const response = await worker.fetch(new Request('https://vazhi.app/@asha', {
      headers: { accept: 'text/html' },
    }), environment())
    const html = await response.text()

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; · @asha | Vazhi')
    expect(html).toContain('Coastal walks &amp; slow mornings &quot;only&quot;.')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('uses canonical download metadata and keeps the browser fallback', async () => {
    const response = await worker.fetch(new Request('https://preview.example/download', {
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
    }), environment())
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<title>Download Vazhi for iPhone</title>')
    expect(html).toContain('<link rel="canonical" href="https://vazhi.app/download">')
  })

  it('rejects invalid guide versions before requesting public data', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await worker.fetch(new Request('https://vazhi.app/@asha/penang-walk?version=constructor', {
      headers: { accept: 'text/html' },
    }), environment())

    expect(upstream).not.toHaveBeenCalled()
    await expect(response.text()).resolves.toContain('Default Vazhi')
  })
})
