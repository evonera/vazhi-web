import { describe, expect, it } from 'vitest'
import { toNativePlace } from '../src/lib/nativePlaceProjection'

describe('native place projection', () => {
  it('preserves a canonical Google ID and coordinates with iOS field names', () => {
    expect(toNativePlace({
      provider: 'google', providerPlaceID: 'ChIJvillage', name: 'Village Park Restaurant',
      address: 'Petaling Jaya, Malaysia', latitude: 3.136, longitude: 101.619,
      primaryType: 'restaurant',
    })).toEqual({
      source: 'google', providerPlaceID: 'ChIJvillage', displayName: 'Village Park Restaurant',
      formattedAddress: 'Petaling Jaya, Malaysia', latitude: 3.136, longitude: 101.619,
      primaryType: 'restaurant',
    })
  })
})
