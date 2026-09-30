/** Validate the small, owner-private subset of a Google Routes response we persist. */
export type RouteSnapshot = {
  distanceMeters: number
  duration: string
  encodedPolyline: string
  legs: Array<{ distanceMeters: number; duration: string }>
  generatedAt: number
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null

const validDistance = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const MAX_DURATION_SECONDS = 315_576_000_000n

const validDuration = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const match = /^(\d+)(?:\.(\d{1,9}))?s$/.exec(value)
  if (!match) return false
  const seconds = BigInt(match[1]!)
  return seconds < MAX_DURATION_SECONDS ||
    (seconds === MAX_DURATION_SECONDS && (!match[2] || /^0+$/.test(match[2])))
}

/** A complete encoded polyline has at least two in-range coordinate pairs. */
export function isValidEncodedPolyline(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  let index = 0
  let latitude = 0
  let longitude = 0
  let points = 0
  while (index < value.length) {
    const deltas: number[] = []
    for (let coordinate = 0; coordinate < 2; coordinate += 1) {
      let unsigned = 0
      let shift = 0
      let continued = true
      while (continued) {
        if (index >= value.length || shift > 50) return false
        const byte = value.charCodeAt(index++) - 63
        if (byte < 0 || byte > 63) return false
        unsigned += (byte & 31) * 2 ** shift
        if (!Number.isSafeInteger(unsigned)) return false
        continued = (byte & 32) !== 0
        shift += 5
      }
      deltas.push(unsigned % 2 === 0 ? unsigned / 2 : -(unsigned + 1) / 2)
    }
    latitude += deltas[0]!
    longitude += deltas[1]!
    if (!Number.isSafeInteger(latitude) || !Number.isSafeInteger(longitude) ||
      Math.abs(latitude) > 90 * 1e5 || Math.abs(longitude) > 180 * 1e5) return false
    points += 1
  }
  return points >= 2
}

function validRouteFields(value: unknown, expectedLegCount: number): value is Omit<RouteSnapshot, 'generatedAt'> {
  const route = record(value)
  if (!route || !Number.isInteger(expectedLegCount) || expectedLegCount < 1 || expectedLegCount > 24 ||
    !validDistance(route.distanceMeters) || !validDuration(route.duration) ||
    !isValidEncodedPolyline(route.encodedPolyline) ||
    !Array.isArray(route.legs) || route.legs.length !== expectedLegCount) return false
  return route.legs.every((value: unknown) => {
    const leg = record(value)
    return leg && validDistance(leg.distanceMeters) && validDuration(leg.duration)
  })
}

export function parseGoogleRouteResponse(body: unknown, expectedLegCount: number): Omit<RouteSnapshot, 'generatedAt'> | null {
  const routes = record(body)?.routes
  if (!Array.isArray(routes) || routes.length === 0) return null
  const first = record(routes[0])
  const polyline = record(first?.polyline)?.encodedPolyline
  const candidate = { distanceMeters: first?.distanceMeters, duration: first?.duration,
    encodedPolyline: polyline, legs: first?.legs }
  if (!validRouteFields(candidate, expectedLegCount)) return null
  return { distanceMeters: candidate.distanceMeters, duration: candidate.duration,
    encodedPolyline: candidate.encodedPolyline,
    legs: candidate.legs.map((leg) => ({ distanceMeters: leg.distanceMeters, duration: leg.duration })) }
}

export function isValidRouteSnapshot(value: unknown, expectedLegCount: number): value is RouteSnapshot {
  const result = record(value)
  const generatedAt = result?.generatedAt
  return result !== null && validRouteFields(result, expectedLegCount) &&
    typeof generatedAt === 'number' && Number.isSafeInteger(generatedAt) && generatedAt > 0
}

export function isUsableCachedRouteSnapshot(value: unknown, expectedLegCount: number, now: number): value is RouteSnapshot & { expiresAt: number } {
  const result = record(value)
  const expiresAt = result?.expiresAt
  return result !== null && isValidRouteSnapshot(result, expectedLegCount) &&
    typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt) &&
    // The action's `now` can precede a concurrently saved cache row by milliseconds.
    Number.isSafeInteger(now) && result.generatedAt <= now + 5_000 &&
    expiresAt > now && expiresAt <= result.generatedAt + 5 * 60 * 1_000
}
