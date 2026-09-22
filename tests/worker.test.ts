import { describe, expect, it } from 'vitest'
import worker, { type Env } from '../src/worker'

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {
      fetch: async () => new Response(`<!doctype html><head><!-- vazhi:meta:start --><title>Vazhi — Ask the Way</title><!-- vazhi:meta:end --></head>`, { headers: { 'content-type': 'text/html' } }),
    },
    ...overrides,
  }
}

describe('Vazhi download route', () => {
  it('redirects iPhone visitors to the configured App Store destination', async () => {
    const response = await worker.fetch(new Request('https://vazhi.app/download', {
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
    }), environment({ IOS_APP_STORE_URL: 'https://apps.apple.com/app/vazhi/id1234567890' }))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://apps.apple.com/app/vazhi/id1234567890')
  })

  it('keeps a browser fallback when no App Store destination is configured', async () => {
    const response = await worker.fetch(new Request('https://vazhi.app/download', {
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    }), environment())

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Vazhi')
  })
})

describe('public metadata', () => {
  it('injects one sanitised metadata set before SPA fallback handles a guide route', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({
      handle: 'rhea', title: 'Penang after dark', subtitle: 'A three-stop evening', disclaimer: 'Public version.',
    }), { headers: { 'content-type': 'application/json' } })

    try {
      const response = await worker.fetch(new Request('https://vazhi.app/@rhea/penang-after-dark', {
        headers: { accept: 'text/html' },
      }), environment({ CONVEX_HTTP_URL: 'https://vazhi.convex.site' }))
      const html = await response.text()

      expect(html).toContain('Penang after dark · @rhea | Vazhi')
      expect(html.match(/<title>/g)).toHaveLength(1)
      expect(html).not.toContain('Vazhi — Ask the Way')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not cache an unavailable Ask card', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('Not found', { status: 404 })

    try {
      const response = await worker.fetch(new Request('https://vazhi.app/og/ask/missing'), environment({ CONVEX_HTTP_URL: 'https://vazhi.convex.site' }))
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
