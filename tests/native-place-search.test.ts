import { describe, expect, it } from 'vitest'
import { parseNativePlaceSearchInput } from '../src/lib/nativePlaceSearch'
import { toNativePlace } from '../src/lib/nativePlaceProjection'

describe('native place search contract', () => {
  it('trims query and Journey destination before server search', () => {
    expect(parseNativePlaceSearchInput({ query: '  Village Park  ', destination: '  Malaysia  ' })).toEqual({
      query: 'Village Park', destination: 'Malaysia',
    })
  })

  it('requires a bounded query and non-empty destination', () => {
    expect(parseNativePlaceSearchInput(null)).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'KL', destination: 'Malaysia' })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'Cafe' })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'Cafe', destination: '   ' })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'x'.repeat(101), destination: 'Malaysia' })).toBeNull()
  })

  it('uses a bounded destination prefix without rejecting a valid Journey', () => {
    const parsed = parseNativePlaceSearchInput({ query: 'Cafe', destination: '🌏'.repeat(140) })
    expect(parsed?.destination).toBe('🌏'.repeat(120))
  })

  it('projects only the canonical native place fields', () => {
    expect(toNativePlace({
      provider: 'google', providerPlaceID: 'place-1', name: 'Village Park',
      address: 'Petaling Jaya', latitude: 3.136, longitude: 101.619, primaryType: 'restaurant',
    })).toEqual({
      source: 'google', providerPlaceID: 'place-1', displayName: 'Village Park',
      formattedAddress: 'Petaling Jaya', latitude: 3.136, longitude: 101.619, primaryType: 'restaurant',
    })
  })
})
