import { describe, expect, it } from 'vitest'
import { isSafeReferenceURL } from '../src/lib/contracts'
import { toOwnerAskRequest, toPublicAskRequest } from '../convex/askProjections'

describe('reference URL validation', () => {
  it('allows HTTPS references only', () => {
    expect(isSafeReferenceURL('https://maps.google.com/?q=Village+Park')).toBe(true)
    expect(isSafeReferenceURL('http://example.com')).toBe(false)
    expect(isSafeReferenceURL('javascript:alert(1)')).toBe(false)
  })
})

describe('Ask the Way response boundary', () => {
  const request = {
    id: 'ask_123',
    localJourneyID: '7A1D5D5B-9F0C-4009-9A16-9EBC95C4A781',
    slug: 'malaysia-ask',
    prompt: 'Where should I go?',
    destination: 'Malaysia',
    journeyTitle: 'Malaysia in November',
    status: 'open' as const,
    createdAt: 1,
    recommendationCount: 3,
  }

  it('includes the local Journey mapping only in an owner response', () => {
    expect(toOwnerAskRequest(request).localJourneyID).toBe(request.localJourneyID)
    expect(toPublicAskRequest(request)).not.toHaveProperty('localJourneyID')
    expect(toPublicAskRequest(request)).not.toHaveProperty('id')
  })

  it('keeps legacy owner requests readable during the staged schema migration', () => {
    const legacyRequest = { ...request, localJourneyID: undefined }
    expect(toOwnerAskRequest(legacyRequest)).toHaveProperty('localJourneyID', undefined)
    expect(toPublicAskRequest(legacyRequest)).not.toHaveProperty('localJourneyID')
  })
})
