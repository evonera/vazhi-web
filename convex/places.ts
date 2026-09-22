import { ConvexError, v } from 'convex/values'
import { internalAction } from './_generated/server'

export const search = internalAction({
  args: { query: v.string(), destination: v.string() },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) throw new ConvexError('Place search is not configured.')
    const query = `${args.query.trim()} ${args.destination.trim()}`.trim()
    if (query.length < 3) return []
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType' },
      body: JSON.stringify({ textQuery: query, pageSize: 5 }),
    })
    if (!response.ok) throw new ConvexError('Place search is temporarily unavailable.')
    const body = await response.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; primaryType?: string }> }
    return (body.places ?? []).flatMap((item) => {
      if (!item.id || !item.displayName?.text || item.location?.latitude === undefined || item.location.longitude === undefined) return []
      return [{ provider: 'google' as const, providerPlaceID: item.id, name: item.displayName.text, address: item.formattedAddress, latitude: item.location.latitude, longitude: item.location.longitude, primaryType: item.primaryType }]
    })
  },
})
