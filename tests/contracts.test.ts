import { describe, expect, it } from 'vitest'
import { getOutboxJobValidationError } from '../convex/syncValidation'
import { toOwnerAskRequest, toPublicAskRequest } from '../convex/askProjections'
import { hasPathStopCapacity, MAX_PATH_STOPS, orderAcceptedRecommendations } from '../convex/acceptedRecommendationOrder'
import { isSafeReferenceURL } from '../src/lib/contracts'

describe('reference URL validation', () => {
  it('allows HTTPS references only', () => {
    expect(isSafeReferenceURL('https://maps.google.com/?q=Village+Park')).toBe(true)
    expect(isSafeReferenceURL('http://example.com')).toBe(false)
    expect(isSafeReferenceURL('javascript:alert(1)')).toBe(false)
  })
})

describe('outbox job preflight validation', () => {
  it('rejects missing Journey snapshots before any sync mutation writes', () => {
    expect(getOutboxJobValidationError({ actionType: 'upsertJourney' })).toContain('Journey snapshot')
  })

  it('rejects a Moment that references a different Journey', () => {
    expect(getOutboxJobValidationError({
      actionType: 'createMoment',
      journey: { id: 'journey-a' },
      moment: { journeyId: 'journey-b' },
    })).toContain('Moment must belong')
  })

  it('accepts complete Journey and Moment snapshots', () => {
    expect(getOutboxJobValidationError({
      actionType: 'createMoment',
      journey: { id: 'journey-a' },
      moment: { journeyId: 'journey-a' },
    })).toBeNull()
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

describe('accepted recommendation ordering', () => {
  it('enforces a transaction-safe maximum Path size', () => {
    expect(hasPathStopCapacity(MAX_PATH_STOPS - 1)).toBe(true)
    expect(hasPathStopCapacity(MAX_PATH_STOPS)).toBe(false)
  })

  it('orders the complete accepted set, including items beyond the former 100-item window', () => {
    const recommendations = Array.from({ length: 101 }, (_, index) => ({
      id: `recommendation-${index}`,
      submittedAt: index + 1,
      acceptedAt: index + 1,
    }))
    recommendations[100] = { ...recommendations[100], submittedAt: 101, acceptedAt: 0 }

    const ordered = orderAcceptedRecommendations(recommendations)

    expect(ordered).toHaveLength(101)
    expect(ordered[0].id).toBe('recommendation-100')
  })
})
