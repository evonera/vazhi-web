import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { createNativeClientSecret } from './configure-native-apple.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const configuration = { pem: privateKey.export({ format: 'pem', type: 'pkcs8' }), teamID: 'DJM3369L94', keyID: 'TESTKEY123', bundleID: 'com.evonera.vazhi', now: 1791072000 }

test('native JWT uses Apple claims, bounded expiry, and raw ES256 signature', () => {
  const { token, claims } = createNativeClientSecret(configuration)
  const [header, payload, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'TESTKEY123' })
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), claims)
  assert.equal(claims.sub, 'com.evonera.vazhi')
  assert.equal(claims.iss, 'DJM3369L94')
  assert.equal(claims.aud, 'https://appleid.apple.com')
  assert.equal(claims.exp - claims.iat, 90 * 86400)
  assert.equal(Buffer.from(signature, 'base64url').length, 64)
  assert.equal(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true)
})

test('invalid identity and excessive lifetime are rejected', () => {
  for (const change of [{ teamID: '' }, { keyID: 'invalid' }, { bundleID: 'https://vazhi.app' }, { days: 181 }, { days: 0 }, { days: 1.5 }, { now: NaN }]) {
    assert.throws(() => createNativeClientSecret({ ...configuration, ...change }))
  }
})

test('a non-Apple signing curve is rejected', () => {
  const wrong = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ format: 'pem', type: 'pkcs8' })
  assert.throws(() => createNativeClientSecret({ ...configuration, pem: wrong }), /P-256/)
})
