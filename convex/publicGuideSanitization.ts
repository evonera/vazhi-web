import { ConvexError } from 'convex/values'

export type PublicGuideStopInput = {
  orderIndex: number
  title: string
  notes: string
  placeName?: string
  locality?: string
  latitude?: number
  longitude?: number
  isApproximateLocation: boolean
}

export type SanitizedPublicGuideStop = Omit<PublicGuideStopInput, 'latitude' | 'longitude'> & {
  latitude?: number
  longitude?: number
}

export function clean(value: string, maximum: number, label: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maximum) throw new ConvexError(`${label} is required and must be ${maximum} characters or fewer.`)
  return trimmed
}

export function sanitizePublicGuideStops(stops: PublicGuideStopInput[]): SanitizedPublicGuideStop[] {
  if (stops.length === 0 || stops.length > 100) throw new ConvexError('Publish between 1 and 100 stops.')
  const seen = new Set<number>()
  return [...stops]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((item, index) => {
      if (!Number.isInteger(item.orderIndex) || item.orderIndex < 0 || seen.has(item.orderIndex)) {
        throw new ConvexError('Each stop needs a unique order.')
      }
      seen.add(item.orderIndex)
      if (item.latitude !== undefined && (item.latitude < -90 || item.latitude > 90)) throw new ConvexError('A stop has invalid latitude.')
      if (item.longitude !== undefined && (item.longitude < -180 || item.longitude > 180)) throw new ConvexError('A stop has invalid longitude.')
      return {
        orderIndex: index,
        title: clean(item.title, 120, 'Stop title'),
        notes: item.notes.trim().slice(0, 1_000),
        placeName: item.placeName?.trim().slice(0, 160) || undefined,
        locality: item.locality?.trim().slice(0, 120) || undefined,
        latitude: item.isApproximateLocation ? undefined : item.latitude,
        longitude: item.isApproximateLocation ? undefined : item.longitude,
        isApproximateLocation: item.isApproximateLocation,
      }
    })
}
