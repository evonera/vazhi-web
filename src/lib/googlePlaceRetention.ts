/** Keep Google's durable identity without retaining response fields. */
export function durableRecommendationPlace<Place extends { provider: 'google' | 'manual'; providerPlaceID?: string }>(place: Place) {
  return place.provider === 'google'
    ? { provider: 'google' as const, providerPlaceID: place.providerPlaceID?.trim() }
    : place
}
