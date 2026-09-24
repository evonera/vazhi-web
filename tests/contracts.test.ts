import { describe, expect, it } from 'vitest'
import { isSafeReferenceURL } from '../src/lib/contracts'
import { buildPlaceAutocompleteInput, buildPlaceSearchQuery, hasValidCoordinates } from '../convex/mapsValidation'

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
