import { describe, expect, it } from 'vitest'
import { parseNativePlaceSearchInput } from '../src/lib/nativePlaceSearch'
import { toNativePlace } from '../src/lib/nativePlaceProjection'
import { parseNativePlaceAutocompleteInput, validPlaceSessionToken } from '../src/lib/nativePlaceAutocomplete'
import { buildGoogleAutocompleteBody, GOOGLE_AUTOCOMPLETE_FIELD_MASK, GOOGLE_PLACE_DETAILS_FIELD_MASK, googlePlaceDetailsURL } from '../convex/mapsValidation'
import { readBoundedRequestBody } from '../src/lib/boundedRequestBody'

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

  it('validates and bounds autocomplete sessions before a billable request', () => {
    const token = '0a0373c2-3f20-4313-836a-c4bdd777b051'
    const parsed = parseNativePlaceAutocompleteInput({ input: '  Cen  ', destination: ' Paris '.repeat(100), sessionToken: token, scope: 'regions' })
    expect(parsed?.input).toBe('Cen')
    expect(parsed?.destination?.length).toBe(120)
    expect(parsed?.sessionToken).toBe(token)
    expect(parsed?.scope).toBe('regions')
    expect(parseNativePlaceAutocompleteInput({ input: 'a', sessionToken: token, scope: 'places' })).toBeNull()
    expect(parseNativePlaceAutocompleteInput({ input: 'Central Park', sessionToken: '../invalid', scope: 'places' })).toBeNull()
    expect(parseNativePlaceAutocompleteInput({ input: 'Central Park', sessionToken: token, destination: 5, scope: 'places' })).toBeNull()
    expect(parseNativePlaceAutocompleteInput({ input: 'Central Park', sessionToken: token, scope: 'anything' })).toBeNull()
    expect(validPlaceSessionToken(token)).toBe(true)
    expect(validPlaceSessionToken('x'.repeat(37))).toBe(false)
  })

  it('uses the same session for region suggestions and canonical details with narrow field masks', () => {
    const session = '0a0373c2-3f20-4313-836a-c4bdd777b051'
    expect(buildGoogleAutocompleteBody('Paris', undefined, session, 'regions')).toEqual({
      input: 'Paris', sessionToken: session, includedPrimaryTypes: ['(regions)'],
    })
    expect(buildGoogleAutocompleteBody('Louvre', 'Paris', session, 'places')).toEqual({
      input: 'Louvre, Paris', sessionToken: session,
    })
    expect(googlePlaceDetailsURL('ChIJtest', session).searchParams.get('sessionToken')).toBe(session)
    expect(GOOGLE_AUTOCOMPLETE_FIELD_MASK).toContain('placePrediction.placeId')
    expect(GOOGLE_PLACE_DETAILS_FIELD_MASK).not.toContain('photos')
  })

  it('rejects oversized owner autocomplete bodies before parsing them', async () => {
    const request = new Request('https://vazhi.app/api/owner/places/autocomplete', {
      method: 'POST', body: 'x'.repeat(2049),
    })
    expect(await readBoundedRequestBody(request, 2048)).toBeNull()
  })
})
