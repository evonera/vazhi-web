import { describe, expect, it } from 'vitest'
import { edgeIngressSignature, verifyEdgeIngressSignature } from '../src/lib/edgeIngressSignature'

const secret = 'edge-test-secret'
const body = JSON.stringify({ slug: 'opaque-request', note: 'A trusted place.' })
const timestamp = 1_700_000_000

describe('edge ingress signatures', () => {
  it('authenticates the untouched raw body inside the replay window', async () => {
    await expect(verifyEdgeIngressSignature({
      rawBody: body,
      signatureHeader: await edgeIngressSignature(body, secret, timestamp),
      signingSecret: secret,
      nowSeconds: timestamp + 60,
    })).resolves.toBe(true)
  })

  it('rejects a changed body, a malformed header, and a replayed signature', async () => {
    const signatureHeader = await edgeIngressSignature(body, secret, timestamp)
    await expect(verifyEdgeIngressSignature({ rawBody: `${body} `, signatureHeader, signingSecret: secret, nowSeconds: timestamp })).resolves.toBe(false)
    await expect(verifyEdgeIngressSignature({ rawBody: body, signatureHeader: 'invalid', signingSecret: secret, nowSeconds: timestamp })).resolves.toBe(false)
    await expect(verifyEdgeIngressSignature({ rawBody: body, signatureHeader, signingSecret: secret, nowSeconds: timestamp + 301 })).resolves.toBe(false)
  })
})
