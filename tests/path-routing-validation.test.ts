import { describe, expect, it } from 'vitest'
import { validatePrivatePathRouteInput, type RouteStopInput } from '../src/lib/pathRoutingValidation'

const stop = (localStopID: string, orderIndex: number, latitude: number): RouteStopInput => ({
  localStopID,
  orderIndex,
  place: { provider: 'apple', latitude, longitude: 76.2 },
})

describe('private Path route input validation', () => {
  it('accepts a bounded, ordered set of Apple-originated coordinates', () => {
    expect(validatePrivatePathRouteInput({
      localPathID: 'path-1', title: 'Kochi food walk', stops: [stop('a', 0, 9.9), stop('b', 1, 10.0)],
    })).toBeNull()
  })

  it('requires at least two and no more than 25 stops', () => {
    expect(validatePrivatePathRouteInput({ localPathID: 'path-1', title: 'Walk', stops: [stop('a', 0, 9.9)] }))
      .toMatch(/2–25/)
    const tooMany = Array.from({ length: 26 }, (_, index) => stop(`s-${index}`, index, 9.9))
    expect(validatePrivatePathRouteInput({ localPathID: 'path-1', title: 'Walk', stops: tooMany }))
      .toMatch(/2–25/)
  })

  it('rejects duplicate stop IDs and duplicate or invalid order values', () => {
    expect(validatePrivatePathRouteInput({
      localPathID: 'path-1', title: 'Walk', stops: [stop('a', 0, 9.9), stop('a', 1, 10.0)],
    })).toMatch(/duplicate or invalid/)
    expect(validatePrivatePathRouteInput({
      localPathID: 'path-1', title: 'Walk', stops: [stop('a', 0, 9.9), stop('b', 0, 10.0)],
    })).toMatch(/duplicate or invalid/)
    expect(validatePrivatePathRouteInput({
      localPathID: 'path-1', title: 'Walk', stops: [stop('a', 0, 9.9), stop('b', 1.5, 10.0)],
    })).toMatch(/invalid stop order/)
  })

  it('rejects invalid geographic coordinates and oversized private fields', () => {
    expect(validatePrivatePathRouteInput({
      localPathID: 'path-1', title: 'Walk', stops: [stop('a', 0, 91), stop('b', 1, 10.0)],
    })).toMatch(/invalid place location/)
    expect(validatePrivatePathRouteInput({
      localPathID: 'path-1', title: 'Walk', stops: [
        { localStopID: 'a', orderIndex: 0, place: { provider: 'google', providerPlaceID: 'ChIJplace1' } },
        { localStopID: 'b', orderIndex: 1, place: { provider: 'google', providerPlaceID: '' } },
      ],
    })).toMatch(/Choose a Google place/)
  })
})
