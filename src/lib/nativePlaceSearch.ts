export type NativePlaceSearchInput = {
  query: string
  destination: string
}

/** Validate the compact, public-field-only body sent by the signed-in iOS client. */
export function parseNativePlaceSearchInput(value: unknown): NativePlaceSearchInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.query !== 'string') return null
  const query = input.query.trim()
  if (query.length < 3 || query.length > 100) return null

  if (typeof input.destination !== 'string') return null
  const destination = input.destination.trim()
  if (destination.length === 0 || destination.length > 120) return null
  return { query, destination }
}
