export type GooglePlaceRecord = {
  provider: 'google'
  providerPlaceID: string
  name: string
  address?: string
  latitude: number
  longitude: number
  primaryType?: string
}

/** Match the native CanonicalPlace Codable keys without exposing credentials. */
export function toNativePlace(place: GooglePlaceRecord) {
  return {
    source: place.provider,
    providerPlaceID: place.providerPlaceID,
    displayName: place.name,
    formattedAddress: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    primaryType: place.primaryType,
  }
}
