export type GeographicPoint = { latitude: number; longitude: number }

export function buildPlaceSearchQuery(query: string, destination: string): string {
  return `${query.trim()} ${destination.trim()}`.trim()
}

export function buildPlaceAutocompleteInput(input: string, destination?: string): string {
  const normalizedInput = input.trim()
  const normalizedDestination = destination?.trim() ?? ''
  return normalizedDestination ? `${normalizedInput}, ${normalizedDestination}` : normalizedInput
}

export const GOOGLE_AUTOCOMPLETE_FIELD_MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat'
export const GOOGLE_PLACE_DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location,primaryType'

export function buildGoogleAutocompleteBody(input: string, destination: string | undefined, sessionToken: string, scope: 'places' | 'regions') {
  return {
    input: buildPlaceAutocompleteInput(input, destination),
    sessionToken,
    ...(scope === 'regions' ? { includedPrimaryTypes: ['(regions)'] } : {}),
  }
}

export function googlePlaceDetailsURL(placeID: string, sessionToken?: string) {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeID)}`)
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken)
  return url
}

export function hasValidCoordinates(point: GeographicPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.latitude >= -90 && point.latitude <= 90 &&
    point.longitude >= -180 && point.longitude <= 180
}
