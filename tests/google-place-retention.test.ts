import { describe, expect, it } from 'vitest'
import { durableRecommendationPlace } from '../src/lib/googlePlaceRetention'

describe('Google place retention', () => {
  it('keeps only the Place ID from a Google recommendation', () => {
    const result = durableRecommendationPlace({
      provider: 'google', providerPlaceID: 'ChIJtest', name: 'Provider name',
      address: 'Provider address', latitude: 9.9, longitude: 76.2, primaryType: 'restaurant',
    })
    expect(result).toEqual({ provider: 'google', providerPlaceID: 'ChIJtest' })
  })

  it('preserves a deliberately pinned manual place', () => {
    const manual = { provider: 'manual' as const, name: 'My pin', latitude: 9.9, longitude: 76.2 }
    expect(durableRecommendationPlace(manual)).toEqual(manual)
  })
})
