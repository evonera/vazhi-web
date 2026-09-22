import { describe, expect, it } from 'vitest'
import { parseRevenueCatWebhook, verifyRevenueCatWebhookSignature } from '../src/lib/revenuecatWebhook'

const secret = 'test-webhook-signing-secret'
const timestamp = 1_700_000_000
const validBody = JSON.stringify({
  api_version: '1.0',
  event: {
    id: 'rc_event_123',
    type: 'INITIAL_PURCHASE',
    event_timestamp_ms: 1_700_000_000_000,
    app_user_id: 'vazhi_opaque_user',
    environment: 'SANDBOX',
    store: 'PADDLE',
    entitlement_ids: ['vazhi_pro', 'vazhi_pro'],
    // These must not escape the parser and therefore never enter Convex.
    price: 12.99,
    country_code: 'IN',
    transaction_id: 'private-transaction-id',
    subscriber_attributes: { email: { value: 'private@example.com' } },
  },
})

async function signatureHeader(body = validBody, time = timestamp): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${body}`))
  const hex = Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `t=${time},v1=${hex}`
}

describe('RevenueCat webhook projection', () => {
  it('keeps only the minimum provider receipt fields', () => {
    expect(parseRevenueCatWebhook(validBody)).toEqual({
      eventID: 'rc_event_123',
      eventType: 'INITIAL_PURCHASE',
      occurredAt: 1_700_000_000_000,
      appUserID: 'vazhi_opaque_user',
      environment: 'SANDBOX',
      store: 'PADDLE',
      entitlementIDs: ['vazhi_pro'],
    })
  })

  it('rejects malformed payloads before a provider receipt can be written', () => {
    expect(parseRevenueCatWebhook('{not JSON}')).toBeUndefined()
    expect(parseRevenueCatWebhook(JSON.stringify({ api_version: '1.0', event: { id: 'missing-required-fields' } }))).toBeUndefined()
  })
})

describe('RevenueCat webhook HMAC', () => {
  it('accepts the exact signed raw body within the replay window', async () => {
    await expect(verifyRevenueCatWebhookSignature({
      rawBody: validBody,
      signatureHeader: await signatureHeader(),
      signingSecret: secret,
      nowSeconds: timestamp + 60,
    })).resolves.toBe(true)
  })

  it('rejects a changed body, malformed header, and replayed timestamp', async () => {
    const signature = await signatureHeader()
    await expect(verifyRevenueCatWebhookSignature({ rawBody: `${validBody} `, signatureHeader: signature, signingSecret: secret, nowSeconds: timestamp })).resolves.toBe(false)
    await expect(verifyRevenueCatWebhookSignature({ rawBody: validBody, signatureHeader: 'invalid', signingSecret: secret, nowSeconds: timestamp })).resolves.toBe(false)
    await expect(verifyRevenueCatWebhookSignature({ rawBody: validBody, signatureHeader: signature, signingSecret: secret, nowSeconds: timestamp + 301 })).resolves.toBe(false)
  })
})
