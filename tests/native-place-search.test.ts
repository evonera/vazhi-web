import { describe, expect, it } from 'vitest'
import { parseNativePlaceSearchInput } from '../src/lib/nativePlaceSearch'

describe('native place search input', () => {
  it('trims query and Journey destination before the server search', () => {
    expect(parseNativePlaceSearchInput({ query: '  Village Park  ', destination: '  Malaysia in November ' })).toEqual({
      query: 'Village Park', destination: 'Malaysia in November',
    })
  })

  it('rejects malformed or oversized search payloads', () => {
    expect(parseNativePlaceSearchInput(null)).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'KL' })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'Cafe' })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'Cafe', destination: '   ' })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'x'.repeat(101) })).toBeNull()
    expect(parseNativePlaceSearchInput({ query: 'Cafe', destination: 'x'.repeat(121) })).toBeNull()
  })
})
