import { describe, expect, it } from 'vitest'
import { isUsableCachedRouteSnapshot, isValidEncodedPolyline, parseGoogleRouteResponse } from './routeResponseValidation'

const encodedPolyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
const leg = { distanceMeters: 0, duration: '0s' }
const response = { routes: [{
  distanceMeters: 0, duration: '0s', polyline: { encodedPolyline }, legs: [leg],
}] }

describe('Google route response validation', () => {
  it('preserves explicit zero-length route and leg values', () => {
    expect(parseGoogleRouteResponse(response, 1)).toEqual({
      distanceMeters: 0, duration: '0s', encodedPolyline, legs: [leg],
    })
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0],
      legs: [{ ...leg, unexpected: 'not part of the owner snapshot' }] }] }, 1)).toEqual({
      distanceMeters: 0, duration: '0s', encodedPolyline, legs: [leg],
    })
  })

  it('rejects missing or invalid route and leg fields and wrong leg counts', () => {
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], legs: [{}] }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], legs: [{ duration: '0s' }] }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], legs: [{ distanceMeters: 0 }] }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], legs: [leg, leg] }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], distanceMeters: -1 }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], duration: 'NaNs' }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0], polyline: {} }] }, 1)).toBeNull()
  })

  it('enforces protobuf Duration bounds on route totals and each leg', () => {
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0],
      duration: '315576000000s', legs: [{ ...leg, duration: '315576000000.000000000s' }] }] }, 1)).not.toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0],
      duration: '315576000001s' }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0],
      duration: '315576000000.000000001s' }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0],
      legs: [{ ...leg, duration: '315576000001s' }] }] }, 1)).toBeNull()
    expect(parseGoogleRouteResponse({ routes: [{ ...response.routes[0],
      legs: [{ ...leg, duration: '999999999999999999999999999999s' }] }] }, 1)).toBeNull()
  })

  it('rejects malformed, truncated, and out-of-range polylines', () => {
    expect(isValidEncodedPolyline(encodedPolyline)).toBe(true)
    expect(isValidEncodedPolyline(encodedPolyline.slice(0, -1))).toBe(false)
    expect(isValidEncodedPolyline('éé')).toBe(false)
    expect(isValidEncodedPolyline('??')).toBe(false) // One point only.
    expect(isValidEncodedPolyline('~~~~~~~~~~~~')).toBe(false)
  })

  it('treats invalid legacy cache rows and expiry anomalies as misses', () => {
    const now = 1_000_000
    const snapshot = { ...parseGoogleRouteResponse(response, 1)!, generatedAt: now - 100,
      expiresAt: now + 100 }
    expect(isUsableCachedRouteSnapshot(snapshot, 1, now)).toBe(true)
    expect(isUsableCachedRouteSnapshot({ ...snapshot, legs: [{}] }, 1, now)).toBe(false)
    expect(isUsableCachedRouteSnapshot({ ...snapshot, duration: '315576000001s' }, 1, now)).toBe(false)
    expect(isUsableCachedRouteSnapshot(snapshot, 2, now)).toBe(false)
    expect(isUsableCachedRouteSnapshot({ ...snapshot, expiresAt: now }, 1, now)).toBe(false)
    expect(isUsableCachedRouteSnapshot({ ...snapshot, generatedAt: now + 5_001 }, 1, now)).toBe(false)
    expect(isUsableCachedRouteSnapshot({ ...snapshot, expiresAt: now + 5 * 60_000 }, 1, now)).toBe(false)
  })
})
