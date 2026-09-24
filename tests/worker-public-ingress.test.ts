import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/worker'
import { verifyEdgeIngressSignature } from '../src/lib/edgeIngressSignature'

const assets = { fetch: vi.fn(async () => new Response('not found', { status: 404 })) }

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: assets,
    CONVEX_HTTP_URL: 'https://example.convex.site',
    EDGE_INGRESS_SIGNING_SECRET: 'edge-secret',
    RATE_LIMIT_SALT: 'rate-secret',
    VAZHI_ENVIRONMENT: 'preview',
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Cloudflare public ingress', () => {
  it('fails closed when preview signing configuration is incomplete', async () => {
    const response = await worker.fetch(
      new Request('https://vazhi.test/places/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'Village Park', slug: 'request-slug' }),
      }),
      environment({ EDGE_INGRESS_SIGNING_SECRET: undefined }),
    )

    expect(response.status).toBe(503)
  })

  it('rejects oversized and non-object JSON before forwarding', async () => {
    const oversized = await worker.fetch(
      new Request('https://vazhi.test/places/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'x'.repeat(17_000) }),
      }),
      environment(),
    )
    const array = await worker.fetch(
      new Request('https://vazhi.test/places/search', { method: 'POST', body: '[]' }),
      environment(),
    )

    expect(oversized.status).toBe(413)
    expect(array.status).toBe(400)
  })

  it('signs the untouched body and forwards only an opaque client key', async () => {
    const body = JSON.stringify({ query: 'Village Park', slug: 'request-slug' })
    let forwarded: Request | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = new Request(input, init)
      return new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' },
      })
    }))

    const response = await worker.fetch(
      new Request('https://vazhi.test/places/search', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.42' },
        body,
      }),
      environment(),
    )

    expect(response.status).toBe(200)
    expect(forwarded?.url).toBe('https://example.convex.site/places/search')
    expect(await forwarded?.text()).toBe(body)
    const rateKey = forwarded?.headers.get('x-vazhi-rate-key')
    expect(rateKey).toMatch(/^[a-f0-9]{64}$/)
    expect(rateKey).not.toContain('203.0.113.42')
    await expect(verifyEdgeIngressSignature({
      rawBody: body,
      signatureHeader: forwarded?.headers.get('x-vazhi-edge-signature') ?? null,
      signingSecret: 'edge-secret',
    })).resolves.toBe(true)
  })

  it('does not forward a recommendation without verified Turnstile', async () => {
    const forwarded = vi.fn()
    vi.stubGlobal('fetch', forwarded)
    const response = await worker.fetch(
      new Request('https://vazhi.test/api/recommendations', {
        method: 'POST',
        body: JSON.stringify({ slug: 'request-slug' }),
      }),
      environment({ TURNSTILE_SECRET_KEY: 'turnstile-secret' }),
    )

    expect(response.status).toBe(400)
    expect(forwarded).not.toHaveBeenCalled()
  })

  it('edge-signs public reports without exposing whether a guide exists', async () => {
    const body = JSON.stringify({ listingSlug: 'penang-walk', reason: 'privacy' })
    let forwarded: Request | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = new Request(input, init)
      return new Response(JSON.stringify({ accepted: true }), {
        headers: { 'content-type': 'application/json' },
      })
    }))

    const response = await worker.fetch(
      new Request('https://vazhi.test/api/reports', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.42' },
        body,
      }),
      environment({ TURNSTILE_SECRET_KEY: 'turnstile-secret' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: true })
    expect(forwarded?.url).toBe('https://example.convex.site/api/reports')
    expect(await forwarded?.text()).toBe(body)
    await expect(verifyEdgeIngressSignature({
      rawBody: body,
      signatureHeader: forwarded?.headers.get('x-vazhi-edge-signature') ?? null,
      signingSecret: 'edge-secret',
    })).resolves.toBe(true)
  })
})
