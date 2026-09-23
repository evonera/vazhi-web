import { describe, expect, it } from 'vitest'
import { parseRouteRefreshInput } from '../convex/routeRefreshValidation'

const validInput = {
  requestID: 'ask-request-id',
  idempotencyKey: 'path-version-1',
  stops: [
    { latitude: 3.139, longitude: 101.6869 },
    { latitude: 5.4141, longitude: 100.3288 },
  ],
}

describe('route refresh input validation', () => {
  it('accepts finite, bounded stops and defaults to driving', () => {
    expect(parseRouteRefreshInput(validInput)).toEqual({ ...validInput, travelMode: 'DRIVE' })
  })

  it('accepts a supported explicit travel mode', () => {
    expect(parseRouteRefreshInput({ ...validInput, travelMode: 'TRANSIT' })?.travelMode).toBe('TRANSIT')
  })

  it.each([
    { ...validInput, stops: [{ latitude: 1, longitude: 2 }] },
    { ...validInput, stops: Array.from({ length: 26 }, () => ({ latitude: 1, longitude: 2 })) },
    { ...validInput, stops: [{ latitude: 91, longitude: 2 }, { latitude: 1, longitude: 2 }] },
    { ...validInput, stops: [{ latitude: 1, longitude: Number.NaN }, { latitude: 1, longitude: 2 }] },
    { ...validInput, travelMode: 'FLY' },
    { ...validInput, idempotencyKey: '' },
  ])('rejects malformed or unbounded input: %o', (input) => {
    expect(parseRouteRefreshInput(input)).toBeNull()
  })
})
