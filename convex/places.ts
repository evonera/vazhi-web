import { ConvexError, v } from 'convex/values'
import { internalAction } from './_generated/server'
import { buildPlaceAutocompleteInput, buildPlaceSearchQuery } from './mapsValidation'

type GooglePlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  primaryType?: string
}

function normalize(item: GooglePlace) {
  if (!item.id || !item.displayName?.text || item.location?.latitude === undefined || item.location.longitude === undefined) return null
  return { provider: 'google' as const, providerPlaceID: item.id, name: item.displayName.text, address: item.formattedAddress, latitude: item.location.latitude, longitude: item.location.longitude, primaryType: item.primaryType }
}

export const search = internalAction({
  args: { query: v.string(), destination: v.string() },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) throw new ConvexError('Place search is not configured.')
    const queryText = args.query.trim()
    const destination = args.destination.trim()
    if (queryText.length > 200 || destination.length > 120) throw new ConvexError('Place search input is too long.')
    const query = buildPlaceSearchQuery(queryText, destination)
    if (query.length < 3) return []
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType' },
      body: JSON.stringify({ textQuery: query, pageSize: 5 }),
    })
    if (!response.ok) throw new ConvexError('Place search is temporarily unavailable.')
    const body = await response.json() as { places?: GooglePlace[] }
    return (body.places ?? []).flatMap((item) => normalize(item) ?? [])
  },
})

// Autocomplete is deliberately a suggestion list, not a place record. The app
// follows it with `details`, which is the only path that normalizes a place.
export const autocomplete = internalAction({
  args: { input: v.string(), destination: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    const input = args.input.trim()
    if (input.length < 2) return []
    const destination = args.destination?.trim() ?? ''
    if (input.length > 200 || destination.length > 120) throw new ConvexError('Place search input is too long.')
    if (!apiKey) throw new ConvexError('Place search is not configured.')
    // Places Autocomplete has no text-destination bias field. Include the
    // Journey destination as query context instead of passing a bogus cursor
    // offset that has no spatial meaning.
    const contextualInput = buildPlaceAutocompleteInput(input, destination)
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({ input: contextualInput }),
    })
    if (!response.ok) throw new ConvexError('Place search is temporarily unavailable.')
    const body = await response.json() as { suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }> }
    return (body.suggestions ?? []).flatMap(({ placePrediction }) => {
      if (!placePrediction?.placeId || !placePrediction.text?.text) return []
      return [{ placeID: placePrediction.placeId, text: placePrediction.text.text, primaryText: placePrediction.structuredFormat?.mainText?.text, secondaryText: placePrediction.structuredFormat?.secondaryText?.text }]
    })
  },
})

export const details = internalAction({
  args: { placeID: v.string() },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (args.placeID.trim().length < 1 || args.placeID.length > 255) throw new ConvexError('A valid Google Place ID is required.')
    if (!apiKey) throw new ConvexError('Place search is not configured.')
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(args.placeID)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,primaryType',
      },
    })
    if (!response.ok) throw new ConvexError('Place details are temporarily unavailable.')
    const place = normalize(await response.json() as GooglePlace)
    if (!place) throw new ConvexError('Place details were incomplete.')
    return place
  },
})
