import { afterEach, expect, test, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'
import { api, components } from '../convex/_generated/api'
import betterAuth from '@convex-dev/better-auth/test'
import rateLimiter from '@convex-dev/rate-limiter/test'

const modules = import.meta.glob('../convex/**/*.ts')
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

test('returning Apple sign-in recovers email only from its linked account', async () => {
  vi.stubEnv('SITE_URL', 'https://vazhi.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://backend.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters-long')
  vi.stubEnv('APPLE_BUNDLE_ID', 'com.evonera.vazhi')
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig' }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === 'https://appleid.apple.com/auth/keys') {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`Unexpected network request: ${String(input)}`)
  }))
  const appleToken = (subject: string) => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-key' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: 'com.evonera.vazhi', sub: subject, iat: now, exp: now + 300 })).toString('base64url')
    const message = `${header}.${payload}`
    return `${message}.${sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }

  const t = convexTest(schema, modules)
  betterAuth.register(t); rateLimiter.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: { name: 'Returning Owner', email: 'owner@example.test', emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } } })
  await t.mutation(components.betterAuth.adapter.create, { input: { model: 'account', data: { accountId: 'known-apple-subject', providerId: 'apple', userId: user._id, createdAt: Date.now(), updatedAt: Date.now() } } })
  const post = (subject: string, cookie?: string) => t.fetch('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ provider: 'apple', disableRedirect: true, idToken: { token: appleToken(subject) } }),
  })

  // Browser cookies on a native request cause Better Auth's origin check to
  // reject the request before Apple token validation.
  expect((await post('known-apple-subject', 'better-auth.session_token=old')).status).toBe(403)
  const returning = await post('known-apple-subject')
  expect(returning.status).toBe(200)
  expect((await returning.json()).user).toMatchObject({ id: user._id, email: 'owner@example.test' })
  // A verified but unknown Apple subject cannot borrow another user's email.
  expect((await post('unknown-apple-subject')).status).toBe(401)
}, 20_000)

test('native grant is single-use, verifier-bound and expires', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  const grant = { codeHash: 'code', codeChallenge: 'challenge', ownerAuthUserId: 'owner-a', sessionToken: 'session' }
  await t.mutation(internal.nativeAuth.createGrant, grant)
  expect(await t.mutation(internal.nativeAuth.consumeGrant, { codeHash: 'code', codeChallenge: 'wrong' })).toBeNull()
  const result = await t.mutation(internal.nativeAuth.consumeGrant, { codeHash: 'code', codeChallenge: 'challenge' })
  expect(result).toEqual({ ownerAuthUserId: 'owner-a', sessionToken: 'session' })
  expect(await t.mutation(internal.nativeAuth.consumeGrant, { codeHash: 'code', codeChallenge: 'challenge' })).toBeNull()
  await t.mutation(internal.nativeAuth.createGrant, { ...grant, codeHash: 'expired' })
  vi.advanceTimersByTime(90_001)
  expect(await t.mutation(internal.nativeAuth.consumeGrant, { codeHash: 'expired', codeChallenge: 'challenge' })).toBeNull()
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
  expect(await t.run(ctx => ctx.db.query('nativeAuthGrants').collect())).toEqual([])
})

test('concurrent exchanges cannot both consume the same grant', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  await t.mutation(internal.nativeAuth.createGrant, { codeHash: 'code', codeChallenge: 'challenge', ownerAuthUserId: 'a', sessionToken: 'secret' })
  const results = await Promise.all([1, 2].map(() => t.mutation(internal.nativeAuth.consumeGrant, { codeHash: 'code', codeChallenge: 'challenge' })))
  expect(results.filter(Boolean)).toHaveLength(1)
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
})

test('live Inbox projection validates the session and isolates owners', async () => {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: { name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } } })
  const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'session', data: { userId: user._id, token: 'session', expiresAt: Date.now() + 60_000, createdAt: Date.now(), updatedAt: Date.now() } } })
  await t.run(async ctx => {
    for (const owner of [String(user._id), 'other-owner']) {
      const journey = await ctx.db.insert('journeys', { ownerAuthUserId: owner, localID: owner, title: 'Trip', destination: 'Malaysia', askRequestCount: 1, openAskRequestCount: 1, recommendationCount: 0, pendingRecommendationCount: 0, updatedAt: 1 })
      await ctx.db.insert('askRequests', { ownerAuthUserId: owner, journeyId: journey, slug: owner, prompt: 'Places?', destination: 'Malaysia', status: 'open', recommendationCount: 0, pendingRecommendationCount: 0, inboxVersion: 3, createdAt: 1 })
    }
  })
  await expect(t.query(api.requests.inboxRevision, {})).rejects.toThrow('Unauthenticated')
  const owner = t.withIdentity({ subject: user._id, sessionId: session._id })
  const revision = await owner.query(api.requests.inboxRevision, {})
  expect(revision).toHaveLength(1)
  expect(revision[0]).toMatchObject({ version: 3, count: 0, status: 'open' })
  const forgedSession = t.withIdentity({ subject: user._id, sessionId: 'not-a-session' })
  await expect(forgedSession.query(api.requests.inboxRevision, {})).rejects.toThrow()
})

test('native authorization rejects missing and cross-origin sessions but accepts an older live session', async () => {
  vi.stubEnv('SITE_URL', 'https://vazhi.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://backend.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters-long')
  const t = convexTest(schema, modules)
  betterAuth.register(t); rateLimiter.register(t)
  const body = JSON.stringify({ challenge: 'a'.repeat(43) })
  expect((await t.fetch('/api/native/authorize', { method: 'POST', headers: { origin: 'https://evil.test' }, body })).status).toBe(403)
  expect((await t.fetch('/api/native/authorize', { method: 'POST', headers: { origin: 'https://vazhi.test' }, body })).status).toBe(401)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: { name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: 1, updatedAt: 1 } } })
  await t.mutation(components.betterAuth.adapter.create, { input: { model: 'session', data: { userId: user._id, token: 'old-session', expiresAt: Date.now() + 60_000, createdAt: Date.now() - 600_000, updatedAt: Date.now() } } })
  const olderLiveSession = await t.fetch('/api/native/authorize', { method: 'POST', headers: { origin: 'https://vazhi.test', authorization: 'Bearer old-session' }, body })
  expect(olderLiveSession.status).toBe(200)
  expect((await olderLiveSession.json()).code).toMatch(/^[A-Za-z0-9_-]{43}$/)
  vi.unstubAllEnvs()
})

test('a recent browser session exchanges a grant for a real owner JWT, once', async () => {
  vi.useFakeTimers()
  vi.stubEnv('SITE_URL', 'https://vazhi.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://backend.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters-long')
  const t = convexTest(schema, modules)
  betterAuth.register(t); rateLimiter.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: { name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } } })
  const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'session', data: { userId: user._id, token: 'fresh-session', expiresAt: Date.now() + 60_000, createdAt: Date.now(), updatedAt: Date.now() } } })
  const verifier = 'a'.repeat(43)
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
  const authorized = await t.fetch('/api/native/authorize', { method: 'POST', headers: { origin: 'https://vazhi.test', authorization: 'Bearer fresh-session' }, body: JSON.stringify({ challenge }) })
  expect(authorized.status).toBe(200)
  const { code } = await authorized.json()
  const exchange = () => t.fetch('/api/native/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) })
  const response = await exchange()
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result).toMatchObject({ authUserID: user._id, authSessionToken: 'fresh-session', email: 'owner@example.test' })
  const payload = JSON.parse(Buffer.from(result.convexAccessToken.split('.')[1], 'base64url').toString())
  expect(payload).toMatchObject({ sub: user._id, sessionId: session._id, iss: 'https://backend.convex.site', aud: 'convex' })
  expect(payload.exp).toBeGreaterThan(Date.now() / 1000)
  expect((await exchange()).status).toBe(401)
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
})

test('email/password login requires verification and sends reset links server-side', async () => {
  vi.stubEnv('SITE_URL', 'https://vazhi.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://backend.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters-long')
  vi.stubEnv('RESEND_API_KEY', 'test-email-key')
  vi.stubEnv('AUTH_EMAIL_FROM', 'Vazhi <accounts@example.test>')
  const messages: { text: string; subject: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    expect(url).toBe('https://api.resend.com/emails')
    messages.push(JSON.parse(options.body))
    return new Response('{}', { status: 200 })
  }))
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  rateLimiter.register(t)
  const credentials = { email: 'new-owner@example.test', password: 'a-secure-test-password' }
  const post = (path: string, body: unknown) => t.fetch(path, { method: 'POST', headers: { origin: 'https://vazhi.test', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  expect((await post('/api/auth/sign-up/email', { ...credentials, name: 'New Owner', callbackURL: 'https://vazhi.test/sign-in' })).status).toBe(200)
  expect(messages[0].subject).toBe('Verify your Vazhi email')
  expect((await post('/api/auth/sign-in/email', credentials)).status).toBe(403)
  const verification = new URL(messages[0].text.split('\n')[0].replace('Verify your email: ', ''))
  expect(verification.origin).toBe('https://vazhi.test')
  expect((await t.fetch(verification.pathname + verification.search)).status).toBe(302)
  const signedIn = await post('/api/auth/sign-in/email', credentials)
  expect(signedIn.status).toBe(200)
  expect((await signedIn.json()).user.emailVerified).toBe(true)
  expect((await post('/api/auth/sign-in/email', { ...credentials, password: 'incorrect-password' })).status).toBe(401)
  expect((await post('/api/auth/request-password-reset', { email: credentials.email, redirectTo: 'https://vazhi.test/sign-in' })).status).toBe(200)
  expect(messages.at(-1)?.subject).toBe('Reset your Vazhi password')
  const resetLink = new URL(messages.at(-1)!.text.split('\n')[0].replace('Reset your password: ', ''))
  expect(resetLink.origin).toBe('https://vazhi.test')
})

test('auth rate limits are durable, atomic and cannot be bypassed with forwarded IPs', async () => {
  vi.stubEnv('SITE_URL', 'https://vazhi.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://backend.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters-long')
  vi.stubEnv('RESEND_API_KEY', 'test-email-key')
  vi.stubEnv('AUTH_EMAIL_FROM', 'accounts@example.test')
  const t = convexTest(schema, modules)
  betterAuth.register(t); rateLimiter.register(t)
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => t.fetch('/api/auth/request-password-reset', {
    method: 'POST', headers: { origin: 'https://vazhi.test', 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${index}` },
    body: JSON.stringify({ email: 'unknown@example.test', redirectTo: 'https://vazhi.test/sign-in' }),
  })))
  expect(responses.filter(response => response.status === 200)).toHaveLength(10)
  expect(responses.filter(response => response.status === 429)).toHaveLength(2)
})
