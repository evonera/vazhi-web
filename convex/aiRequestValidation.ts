/** The native app sends only the moment text the user approved for cloud use. */
export type CloudAISuggestionRequest = {
  journeyTitle: string
  journeySummary: string
  moments: Array<{
    id: string
    note: string
    placeName?: string
    locality?: string
  }>
}

/**
 * Validate and project the public request into the smaller provider contract.
 * Unknown fields are deliberately discarded so timestamps, coordinates,
 * transcripts, or future client fields cannot accidentally reach the model.
 */
export function parseCloudAISuggestionRequest(input: unknown): CloudAISuggestionRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (value.journeyTitle !== undefined && (typeof value.journeyTitle !== 'string' || value.journeyTitle.trim().length > 160)) return null
  if (value.journeySummary !== undefined && (typeof value.journeySummary !== 'string' || value.journeySummary.length > 1_000)) return null
  if (!Array.isArray(value.moments) || value.moments.length === 0 || value.moments.length > 20) return null

  const moments: CloudAISuggestionRequest['moments'] = []
  for (const entry of value.moments) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const moment = entry as Record<string, unknown>
    if (typeof moment.id !== 'string' || moment.id.length === 0 || moment.id.length > 128 ||
        typeof moment.note !== 'string' || moment.note.length > 2_000 ||
        (moment.placeName !== undefined && (typeof moment.placeName !== 'string' || moment.placeName.length > 160)) ||
        (moment.locality !== undefined && (typeof moment.locality !== 'string' || moment.locality.length > 160))) return null

    moments.push({
      id: moment.id,
      note: moment.note,
      ...(typeof moment.placeName === 'string' ? { placeName: moment.placeName } : {}),
      ...(typeof moment.locality === 'string' ? { locality: moment.locality } : {}),
    })
  }

  const title = typeof value.journeyTitle === 'string' && value.journeyTitle.trim() ? value.journeyTitle.trim() : 'Travel journal'
  return {
    journeyTitle: title,
    journeySummary: typeof value.journeySummary === 'string' ? value.journeySummary : '',
    moments,
  }
}
