export type NativePlaceAutocompleteInput = {
  input: string
  destination?: string
  sessionToken: string
  scope: 'places' | 'regions'
}

// Google recommends a fresh UUID for each query-to-selection session. Never
// accept arbitrary URL text from the client as a token or place identifier.
export function validPlaceSessionToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,36}$/.test(value)
}

export function parseNativePlaceAutocompleteInput(value: unknown): NativePlaceAutocompleteInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (typeof body.input !== 'string' || !validPlaceSessionToken(body.sessionToken)) return null
  if (body.scope !== 'places' && body.scope !== 'regions') return null
  const input = body.input.trim()
  if (input.length < 2 || input.length > 100) return null
  if (body.destination !== undefined && typeof body.destination !== 'string') return null
  const destination = (body.destination as string | undefined)?.trim()
  return { input, destination: destination ? Array.from(destination).slice(0, 120).join('') : undefined, sessionToken: body.sessionToken, scope: body.scope }
}
