import { describe, expect, it } from 'vitest'
import { opaqueEdgeRateLimitKey } from '../convex/rateLimitKey'

describe('opaque public-ingress rate keys', () => {
  it('uses a stable HMAC for the same salt and edge IP without returning the IP', async () => {
    const first = await opaqueEdgeRateLimitKey('secret-a', '203.0.113.7', true)
    expect(first).toBe(await opaqueEdgeRateLimitKey('secret-a', '203.0.113.7', true))
    expect(first).not.toContain('203.0.113.7')
    expect(first).not.toBe(await opaqueEdgeRateLimitKey('secret-a', '203.0.113.8', true))
    expect(first).not.toBe(await opaqueEdgeRateLimitKey('secret-b', '203.0.113.7', true))
  })

  it('fails closed in production when rate-limit inputs are missing', async () => {
    await expect(opaqueEdgeRateLimitKey(undefined, '203.0.113.7', true)).rejects.toThrow('rate-limit salt')
    await expect(opaqueEdgeRateLimitKey('secret-a', null, true)).rejects.toThrow('edge IP')
  })
})
