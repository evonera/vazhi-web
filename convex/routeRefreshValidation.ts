export type RouteRefreshInput = {
  requestID: string
  idempotencyKey: string
  stops: Array<{ latitude: number; longitude: number }>
  travelMode: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT'
}

const travelModes = new Set<RouteRefreshInput['travelMode']>(['DRIVE', 'WALK', 'BICYCLE', 'TRANSIT'])

export function parseRouteRefreshInput(value: unknown): RouteRefreshInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.requestID !== 'string' || input.requestID.length < 1 || input.requestID.length > 128) return null
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128) return null
  if (!Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > 25) return null
  const stops: RouteRefreshInput['stops'] = []
  for (const value of input.stops) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const stop = value as Record<string, unknown>
    if (typeof stop.latitude !== 'number' || !Number.isFinite(stop.latitude) || stop.latitude < -90 || stop.latitude > 90) return null
    if (typeof stop.longitude !== 'number' || !Number.isFinite(stop.longitude) || stop.longitude < -180 || stop.longitude > 180) return null
    stops.push({ latitude: stop.latitude, longitude: stop.longitude })
  }
  const travelMode = input.travelMode === undefined ? 'DRIVE' : input.travelMode
  if (typeof travelMode !== 'string' || !travelModes.has(travelMode as RouteRefreshInput['travelMode'])) return null
  return { requestID: input.requestID, idempotencyKey: input.idempotencyKey, stops, travelMode: travelMode as RouteRefreshInput['travelMode'] }
}
