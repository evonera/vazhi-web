export type GeographicPoint = { latitude: number; longitude: number }

export function buildPlaceSearchQuery(query: string, destination: string): string {
  return `${query.trim()} ${destination.trim()}`.trim()
}

export function buildPlaceAutocompleteInput(input: string, destination?: string): string {
  const normalizedInput = input.trim()
  const normalizedDestination = destination?.trim() ?? ''
  return normalizedDestination ? `${normalizedInput}, ${normalizedDestination}` : normalizedInput
}

export function hasValidCoordinates(point: GeographicPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.latitude >= -90 && point.latitude <= 90 &&
    point.longitude >= -180 && point.longitude <= 180
}
