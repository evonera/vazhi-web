export type NativePlaceSearchInput = {
  query: string
  destination: string
}

/** Validate the compact, public-field-only body sent by the signed-in iOS client. */
export function parseNativePlaceSearchInput(value: unknown): NativePlaceSearchInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.query !== 'string' || typeof input.destination !== 'string') return null

  const query = input.query.trim()
  const destination = input.destination.trim()
  if (query.length < 3 || query.length > 100) return null
  if (destination.length === 0) return null

  // A Journey destination is user-authored and has no storage-level length
  // cap. It is only search context here, so retain a bounded prefix instead of
  // rejecting an otherwise valid Journey.
  const destinationBias = Array.from(destination).slice(0, 120).join('')
  return { query, destination: destinationBias }
}
