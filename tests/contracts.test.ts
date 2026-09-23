import { describe, expect, it } from 'vitest'
import { isSafeReferenceURL } from '../src/lib/contracts'
import { getOutboxJobValidationError } from '../convex/syncValidation'

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
