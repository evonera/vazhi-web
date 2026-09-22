import { describe, expect, it } from 'vitest'
import { isSafeReferenceURL } from '../src/lib/contracts'
import { buildPlaceAutocompleteInput, buildPlaceSearchQuery, hasValidCoordinates } from '../convex/mapsValidation'
import { getOutboxJobValidationError, isSnapshotNewer } from '../convex/syncValidation'
import { toOwnerAskRequest, toPublicAskRequest } from '../convex/askProjections'

describe('reference URL validation', () => {
  it('allows HTTPS references only', () => {
    expect(isSafeReferenceURL('https://maps.google.com/?q=Village+Park')).toBe(true)
    expect(isSafeReferenceURL('http://example.com')).toBe(false)
    expect(isSafeReferenceURL('javascript:alert(1)')).toBe(false)
  })
})

describe('Google Maps input validation', () => {
  it('biases text search and autocomplete with destination context', () => {
    expect(buildPlaceSearchQuery('  nasi lemak ', ' Kuala Lumpur ')).toBe('nasi lemak Kuala Lumpur')
    expect(buildPlaceAutocompleteInput('Village Park', 'Kuala Lumpur')).toBe('Village Park, Kuala Lumpur')
    expect(buildPlaceAutocompleteInput('Village Park')).toBe('Village Park')
  })

  it('accepts geographic boundary coordinates and rejects out-of-range values', () => {
    expect(hasValidCoordinates({ latitude: 90, longitude: 180 })).toBe(true)
    expect(hasValidCoordinates({ latitude: -90, longitude: -180 })).toBe(true)
    expect(hasValidCoordinates({ latitude: 91, longitude: 0 })).toBe(false)
    expect(hasValidCoordinates({ latitude: 0, longitude: 181 })).toBe(false)
    expect(hasValidCoordinates({ latitude: Number.NaN, longitude: 0 })).toBe(false)
  })
})

describe('outbox job preflight validation', () => {
  const validJob = {
    jobId: 'job-1',
    createdAt: '2026-09-24T00:00:00.000Z',
    actionType: 'createMoment' as const,
    journeyId: 'journey-a',
    journey: { id: 'journey-a', updatedAt: '2026-09-24T00:00:00.000Z' },
    moment: { id: 'moment-a', journeyId: 'journey-a' },
  }

  it('rejects missing Journey snapshots before any sync mutation writes', () => {
    expect(getOutboxJobValidationError({ ...validJob, journey: undefined })).toContain('Journey snapshot')
  })

  it('rejects empty job, Journey, and Moment identifiers', () => {
    expect(getOutboxJobValidationError({ ...validJob, jobId: '  ' })).toContain('job ID')
    expect(getOutboxJobValidationError({ ...validJob, journey: { ...validJob.journey, id: '' } })).toContain('Journey ID')
    expect(getOutboxJobValidationError({ ...validJob, moment: { ...validJob.moment, id: '  ' } })).toContain('Moment must belong')
  })

  it('rejects inconsistent redundant Journey IDs and missing Moment snapshots', () => {
    expect(getOutboxJobValidationError({ ...validJob, journeyId: 'journey-b' })).toContain('Journey ID must match')
    expect(getOutboxJobValidationError({ ...validJob, moment: undefined })).toContain('Moment snapshot is required')
  })

  it('rejects a Moment that references a different Journey', () => {
    expect(getOutboxJobValidationError({
      ...validJob,
      moment: { id: 'moment-a', journeyId: 'journey-b' },
    })).toContain('Moment must belong')
  })

  it('accepts complete Journey and Moment snapshots', () => {
    expect(getOutboxJobValidationError(validJob)).toBeNull()
  })
})

describe('outbox source snapshot ordering', () => {
  it('does not allow an older source snapshot to replace newer synced data', () => {
    expect(isSnapshotNewer(
      '2026-09-24T00:00:00.000Z', '2026-09-24T00:02:00.000Z',
      '2026-09-24T00:01:00.000Z', '2026-09-24T00:01:00.000Z',
    )).toBe(false)
  })

  it('uses outbox creation time to deterministically break equal source-version ties', () => {
    expect(isSnapshotNewer(
      '2026-09-24T00:00:00.000Z', '2026-09-24T00:02:00.000Z',
      '2026-09-24T00:00:00.000Z', '2026-09-24T00:01:00.000Z',
    )).toBe(true)
  })

  it('accepts the first snapshot and rejects malformed timestamps', () => {
    expect(isSnapshotNewer('2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')).toBe(true)
    expect(isSnapshotNewer('invalid', '2026-09-24T00:00:00.000Z')).toBe(false)
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
