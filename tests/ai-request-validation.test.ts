import { describe, expect, it } from 'vitest'
import { parseCloudAISuggestionRequest } from '../convex/aiRequestValidation'

describe('native cloud-AI request contract', () => {
  it('accepts the consented iOS payload without journey metadata or capture timestamps', () => {
    const request = parseCloudAISuggestionRequest({
      moments: [{ id: 'moment-1', note: 'Tea near the harbor', placeName: 'Fort Kochi' }],
    })

    expect(request).toEqual({
      journeyTitle: 'Travel journal',
      journeySummary: '',
      moments: [{ id: 'moment-1', note: 'Tea near the harbor', placeName: 'Fort Kochi' }],
    })
  })

  it('projects away timestamps, coordinates, and other unapproved fields', () => {
    const request = parseCloudAISuggestionRequest({
      moments: [{
        id: 'moment-1', note: 'Tea near the harbor', capturedAt: 123,
        latitude: 10.01, longitude: 76.31, transcript: 'private transcript',
      }],
    })

    expect(request?.moments[0]).toEqual({ id: 'moment-1', note: 'Tea near the harbor' })
    expect(JSON.stringify(request)).not.toMatch(/capturedAt|latitude|longitude|transcript/)
  })

  it('retains optional journey context when a trusted client supplies it', () => {
    expect(parseCloudAISuggestionRequest({
      journeyTitle: 'Penang', journeySummary: 'A food weekend',
      moments: [{ id: 'moment-1', note: 'Noodles at the market' }],
    })).toMatchObject({ journeyTitle: 'Penang', journeySummary: 'A food weekend' })
  })

  it('rejects malformed or oversized moment sets', () => {
    expect(parseCloudAISuggestionRequest({ moments: [] })).toBeNull()
    expect(parseCloudAISuggestionRequest({ moments: [{ id: '', note: 'x' }] })).toBeNull()
    expect(parseCloudAISuggestionRequest({ moments: [{ id: 'm', note: 'x'.repeat(2_001) }] })).toBeNull()
    expect(parseCloudAISuggestionRequest({ moments: Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, note: '' })) })).toBeNull()
  })
})
