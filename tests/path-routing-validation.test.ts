import { describe, expect, it } from 'vitest'
import { isCurrentRouteRevision, validatePrivatePathRouteInput } from '../src/lib/pathRoutingValidation'

const valid = {
  localPathID: 'path-1',
  title: 'Malaysia food day',
  stops: [
    { localStopID: 'one', orderIndex: 0, place: { provider: 'google' as const, providerPlaceID: 'google-one' } },
    { localStopID: 'two', orderIndex: 1, place: { provider: 'manual' as const, latitude: 3.14, longitude: 101.69 } },
  ],
}

describe('private Path routing validation', () => {
  it('accepts a bounded provider-honest route projection', () => {
    expect(validatePrivatePathRouteInput(valid)).toBeNull()
  })

  it('rejects duplicate trimmed IDs, orders, invalid coordinates, and missing Google identity', () => {
    expect(validatePrivatePathRouteInput({ ...valid, stops: [valid.stops[0], { ...valid.stops[1], localStopID: ' one ' }] })).toMatch(/duplicate/)
    expect(validatePrivatePathRouteInput({ ...valid, stops: [valid.stops[0], { ...valid.stops[1], orderIndex: 0 }] })).toMatch(/duplicate/)
    expect(validatePrivatePathRouteInput({ ...valid, stops: [valid.stops[0], { ...valid.stops[1], place: { provider: 'manual', latitude: 91, longitude: 0 } }] })).toMatch(/invalid place/)
    expect(validatePrivatePathRouteInput({ ...valid, stops: [{ ...valid.stops[0], place: { provider: 'google', providerPlaceID: '  ' } }, valid.stops[1]] })).toMatch(/Google place/)
  })

  it('rejects an outdated route result after stop edits', () => {
    expect(isCurrentRouteRevision(4, 4)).toBe(true)
    expect(isCurrentRouteRevision(5, 4)).toBe(false)
  })
})
