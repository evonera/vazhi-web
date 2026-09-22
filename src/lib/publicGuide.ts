/** A guide-wide privacy choice always overrides a stop's local setting. */
export function redactPublicCoordinates<T extends {
  latitude?: number
  longitude?: number
  isApproximateLocation: boolean
}>(stop: T, approximateLocations: boolean): T {
  if (!approximateLocations && !stop.isApproximateLocation) return stop
  return {
    ...stop,
    latitude: undefined,
    longitude: undefined,
    isApproximateLocation: true,
  }
}
