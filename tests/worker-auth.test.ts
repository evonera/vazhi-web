import { afterEach, expect, test, vi } from 'vitest'
import worker, { type Env } from '../src/worker'

const env: Env = { ASSETS: { fetch: async () => new Response('asset') }, CONVEX_HTTP_URL: 'https://backend.convex.site' }
afterEach(() => vi.unstubAllGlobals())

test('auth proxy preserves cookies, provider redirects and no-store without following redirects', async () => {
  const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/oauth', 'set-cookie': '__Secure-better-auth.session_token=value; Secure; HttpOnly; SameSite=Lax; Path=/' } }))
  vi.stubGlobal('fetch', upstream)
  const response = await worker.fetch(new Request('https://vazhi.test/api/auth/sign-in/social', { method: 'POST', headers: { origin: 'https://vazhi.test', cookie: 'session=test', 'content-type': 'application/json', 'x-vazhi-rate-key': 'forged' }, body: '{}' }), env)
  const [url, options] = upstream.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.href).toBe('https://backend.convex.site/api/auth/sign-in/social')
  expect(options.redirect).toBe('manual')
  expect(new Headers(options.headers).get('cookie')).toBe('session=test')
  expect(new Headers(options.headers).has('x-vazhi-rate-key')).toBe(false)
  expect(response.status).toBe(302)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('auth proxy rejects cross-site writes, unsupported methods and missing upstream', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect((await worker.fetch(new Request('https://vazhi.test/api/auth/sign-out', { method: 'POST', headers: { origin: 'https://evil.test' } }), env)).status).toBe(403)
  expect((await worker.fetch(new Request('https://vazhi.test/api/auth/test', { method: 'DELETE' }), env)).status).toBe(405)
  expect((await worker.fetch(new Request('https://vazhi.test/api/auth/get-session'), { ...env, CONVEX_HTTP_URL: undefined })).status).toBe(503)
  expect(fetcher).not.toHaveBeenCalled()
})

test('owner JWT stays in Authorization and upstream failures are generic', async () => {
  const upstream = vi.fn(async (_url: unknown, options: RequestInit) => {
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer test-jwt')
    throw new Error('private detail')
  })
  vi.stubGlobal('fetch', upstream)
  const response = await worker.fetch(new Request('https://vazhi.test/api/owner/ask-requests', { headers: { authorization: 'Bearer test-jwt' } }), env)
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('private detail')
})
