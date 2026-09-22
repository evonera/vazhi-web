import { describe, expect, it } from 'vitest'
import { identifiedWebPurchaseLink } from '../src/lib/webPurchaseLink'

describe('identified RevenueCat Web Purchase Link', () => {
  it('adds the exact opaque App User ID as one encoded path segment', () => {
    expect(identifiedWebPurchaseLink('https://pay.rev.cat/ProductionToken', 'user/with?spaces &')).toBe(
      'https://pay.rev.cat/ProductionToken/user%2Fwith%3Fspaces%20%26',
    )
  })

  it('fails closed without production configuration or identity', () => {
    expect(identifiedWebPurchaseLink(undefined, 'owner-id')).toBeNull()
    expect(identifiedWebPurchaseLink('https://pay.rev.cat/ProductionToken', '')).toBeNull()
  })

  it('rejects untrusted hosts, insecure URLs and non-template links', () => {
    for (const template of [
      'http://pay.rev.cat/Token',
      'https://pay.rev.cat.evil.test/Token',
      'https://pay.rev.cat/Token/already-identified',
      'https://pay.rev.cat/Token?email=someone@example.com',
      'https://pay.rev.cat/Token#checkout',
      'https://user@pay.rev.cat/Token',
    ]) expect(identifiedWebPurchaseLink(template, 'owner-id')).toBeNull()
  })
})
