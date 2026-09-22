import { describe, expect, it } from 'vitest'
import worker, { type Env } from '../src/worker'
import { verifyEdgeIngressSignature } from '../src/lib/edgeIngressSignature'

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

describe('public write ingress', () => {
  it('fails closed in an unconfigured production-like Worker before forwarding', async () => {
    const response = await worker.fetch(new Request('https://vazhi.app/api/recommendations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }), environment({ CONVEX_HTTP_URL: 'https://vazhi.convex.site', VAZHI_ENVIRONMENT: 'preview' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: 'Please complete the verification and try again.' })
  })

  it('forwards an explicitly-development write without a production secret', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe('https://vazhi.convex.site/api/reports')
      return new Response(JSON.stringify({ accepted: true }), { headers: { 'content-type': 'application/json' } })
    }
    try {
      const response = await worker.fetch(new Request('https://vazhi.app/api/reports', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingSlug: 'guide', reason: 'spam' }),
      }), environment({ CONVEX_HTTP_URL: 'https://vazhi.convex.site', VAZHI_ENVIRONMENT: 'development' }))
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ accepted: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('verifies Turnstile then signs production writes before forwarding them', async () => {
    const originalFetch = globalThis.fetch
    const body = JSON.stringify({ listingSlug: 'guide', reason: 'spam', turnstileToken: 'challenge-token' })
    let calls = 0
    globalThis.fetch = async (input, init) => {
      calls += 1
      if (String(input).startsWith('https://challenges.cloudflare.com/')) return new Response(JSON.stringify({ success: true }))
      expect(String(input)).toBe('https://vazhi.convex.site/api/reports')
      await expect(verifyEdgeIngressSignature({
        rawBody: String(init?.body),
        signatureHeader: new Headers(init?.headers).get('x-vazhi-edge-signature'),
        signingSecret: 'edge-secret',
      })).resolves.toBe(true)
      expect(new Headers(init?.headers).get('x-vazhi-rate-key')).toMatch(/^[a-f0-9]{64}$/)
      expect(new Headers(init?.headers).get('cf-connecting-ip')).toBeNull()
      return new Response(JSON.stringify({ accepted: true }), { headers: { 'content-type': 'application/json' } })
    }
    try {
      const response = await worker.fetch(new Request('https://vazhi.app/api/reports', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      }), environment({
        CONVEX_HTTP_URL: 'https://vazhi.convex.site',
        VAZHI_ENVIRONMENT: 'preview',
        TURNSTILE_SECRET_KEY: 'turnstile-secret',
        EDGE_INGRESS_SIGNING_SECRET: 'edge-secret',
        RATE_LIMIT_SALT: 'rate-limit-secret',
      }))
      expect(calls).toBe(2)
      await expect(response.json()).resolves.toEqual({ accepted: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('signs public place search at the edge without allowing direct Google proxy routes', async () => {
    const originalFetch = globalThis.fetch
    const body = JSON.stringify({ slug: 'malaysia', query: 'Village Park' })
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe('https://vazhi.convex.site/places/search')
      await expect(verifyEdgeIngressSignature({
        rawBody: String(init?.body),
        signatureHeader: new Headers(init?.headers).get('x-vazhi-edge-signature'),
        signingSecret: 'edge-secret',
      })).resolves.toBe(true)
      expect(new Headers(init?.headers).get('x-vazhi-rate-key')).toMatch(/^[a-f0-9]{64}$/)
      return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } })
    }
    try {
      const response = await worker.fetch(new Request('https://vazhi.app/places/search', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      }), environment({
        CONVEX_HTTP_URL: 'https://vazhi.convex.site',
        VAZHI_ENVIRONMENT: 'production',
        EDGE_INGRESS_SIGNING_SECRET: 'edge-secret',
        RATE_LIMIT_SALT: 'rate-limit-secret',
      }))
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
