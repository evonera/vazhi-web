/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { symmetricDecrypt } from 'better-auth/crypto'
import { convexTest } from 'convex-test'
import betterAuth from '@convex-dev/better-auth/test'
import rateLimiter from '@convex-dev/rate-limiter/test'
import schema from './schema'
import { components, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const encryptionKey = 'test-encryption-key-over-thirty-two-characters'
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function fixture() {
  vi.useFakeTimers()
  vi.stubEnv('SITE_URL', 'https://vazhi.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://backend.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRET', encryptionKey)
  vi.stubEnv('APPLE_BUNDLE_ID', 'com.evonera.vazhi')
  vi.stubEnv('APPLE_NATIVE_CLIENT_SECRET', 'test-native-secret')
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'credential-test', alg: 'ES256', use: 'sig' }
  const token = (subject = 'apple-subject', audience = 'com.evonera.vazhi', expired = false) => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: jwk.kid })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: audience,
      sub: subject, iat: now, exp: expired ? now - 1 : now + 300 })).toString('base64url')
    const message = `${header}.${payload}`
    return `${message}.${sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  const t = convexTest(schema, modules)
  betterAuth.register(t); rateLimiter.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: Date.now(), updatedAt: Date.now(),
  } } })
  await t.mutation(components.betterAuth.adapter.create, { input: { model: 'account', data: {
    accountId: 'apple-subject', providerId: 'apple', userId: user._id, createdAt: Date.now(), updatedAt: Date.now(),
  } } })
  await t.mutation(components.betterAuth.adapter.create, { input: { model: 'session', data: {
    userId: user._id, token: 'fresh-session', expiresAt: Date.now() + 60_000, createdAt: Date.now(), updatedAt: Date.now(),
  } } })
  let exchangedSubject = 'apple-subject'
  let revokeStatus = 200
  const tokenBodies: URLSearchParams[] = []
  const revokeBodies: URLSearchParams[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input)
    if (url === 'https://appleid.apple.com/auth/keys') return Response.json({ keys: [jwk] })
    if (url === 'https://appleid.apple.com/auth/token') {
      expect(options?.redirect).toBe('error')
      tokenBodies.push(new URLSearchParams(String(options?.body)))
      return Response.json({ id_token: token(exchangedSubject), refresh_token: 'apple-refresh-test-value' })
    }
    if (url === 'https://appleid.apple.com/auth/revoke') {
      expect(options?.redirect).toBe('error')
      revokeBodies.push(new URLSearchParams(String(options?.body)))
      return new Response(null, { status: revokeStatus })
    }
    throw new Error('Unexpected external request')
  }))
  const post = (identityToken = token(), authorization = 'fresh-session', extraHeaders = {}) => t.fetch('/api/native/apple/credentials', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${authorization}`, ...extraHeaders },
    body: JSON.stringify({ authorizationCode: 'one-time-code', identityToken }),
  })
  return { t, user, token, post, tokenBodies, revokeBodies,
    mismatchedExchange: () => { exchangedSubject = 'different-apple-subject' },
    failRevocation: () => { revokeStatus = 400 },
  }
}

test('Apple code exchange stores only an encrypted token and deletion revokes then purges it', async () => {
  const f = await fixture()
  const response = await f.post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ stored: true })
  const stored = await f.t.query(internal.appleCredentials.forDeletion, { ownerAuthUserId: String(f.user._id) })
  expect(stored?.encryptedRefreshToken).not.toContain('apple-refresh-test-value')
  expect(await symmetricDecrypt({ key: encryptionKey, data: stored!.encryptedRefreshToken })).toBe('apple-refresh-test-value')
  expect(f.tokenBodies[0].get('client_id')).toBe('com.evonera.vazhi')
  expect(f.tokenBodies[0].get('client_secret')).toBe('test-native-secret')
  const deleted = await f.t.fetch('/api/auth/delete-user', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fresh-session' }, body: '{}',
  })
  expect(deleted.status).toBe(200)
  expect(f.revokeBodies[0].get('token')).toBe('apple-refresh-test-value')
  expect(f.revokeBodies[0].get('token_type_hint')).toBe('refresh_token')
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await f.t.query(internal.appleCredentials.forDeletion, { ownerAuthUserId: String(f.user._id) })).toBeNull()
})

test('unsigned, wrong-audience, expired and mismatched Apple tokens cannot store credentials', async () => {
  const f = await fixture()
  const signed = f.token()
  const [header, payload, signature] = signed.split('.')
  const invalidSignature = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
  for (const invalid of ['unsigned.payload.token', invalidSignature, f.token('apple-subject', 'web-service-id'), f.token('apple-subject', undefined, true)]) {
    expect((await f.post(invalid)).status).toBe(400)
  }
  expect(f.tokenBodies).toHaveLength(0)
  f.mismatchedExchange()
  expect((await f.post()).status).toBe(400)
  expect(await f.t.query(internal.appleCredentials.forDeletion, { ownerAuthUserId: String(f.user._id) })).toBeNull()
})

test('credential collection requires a live bearer session and its linked Apple subject', async () => {
  const f = await fixture()
  expect((await f.post(f.token(), 'invalid-session')).status).toBe(401)
  expect((await f.post(f.token(), 'fresh-session', { cookie: 'old-cookie' })).status).toBe(403)
  expect((await f.post(f.token(), 'fresh-session', { origin: 'https://evil.test' })).status).toBe(403)
  await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: 'account', where: [{ field: 'userId', value: f.user._id }] } })
  expect((await f.post()).status).toBe(403)
  expect(await f.t.query(internal.appleCredentials.forDeletion, { ownerAuthUserId: String(f.user._id) })).toBeNull()
})

test('missing native secret does not substitute the web secret or block account deletion', async () => {
  const f = await fixture()
  vi.stubEnv('APPLE_NATIVE_CLIENT_SECRET', '')
  vi.stubEnv('APPLE_CLIENT_SECRET', 'web-secret-must-not-be-used')
  expect((await f.post()).status).toBe(503)
  expect(f.tokenBodies).toHaveLength(0)
  const deleted = await f.t.fetch('/api/auth/delete-user', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fresh-session' }, body: '{}',
  })
  expect(deleted.status).toBe(200)
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
})

test('a provider revocation failure does not retain tokens or prevent requested account deletion', async () => {
  const f = await fixture()
  expect((await f.post()).status).toBe(200)
  f.failRevocation()
  expect((await f.t.fetch('/api/auth/delete-user', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fresh-session' }, body: '{}',
  })).status).toBe(200)
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await f.t.query(internal.appleCredentials.forDeletion, { ownerAuthUserId: String(f.user._id) })).toBeNull()
})
