export const MAX_AI_REQUEST_BYTES = 64 * 1024
export const MAX_AI_MOMENTS = 20

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
 * Projects an owner-approved request into the complete provider input shape.
 * Unknown properties are intentionally dropped. In particular, media,
 * coordinates, timestamps, transcript fields and other Moment metadata have
 * no representation here. The native client sends only Moments selected in
 * its consent sheet; every Moment in this smaller payload is therefore an
 * explicitly selected source.
 */
export function parseCloudAISuggestionRequest(input: unknown): CloudAISuggestionRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (value.journeyTitle !== undefined &&
      (typeof value.journeyTitle !== 'string' || value.journeyTitle.trim().length > 160)) return null
  if (value.journeySummary !== undefined &&
      (typeof value.journeySummary !== 'string' || value.journeySummary.length > 1_000)) return null
  if (!Array.isArray(value.moments) || value.moments.length === 0 || value.moments.length > MAX_AI_MOMENTS) return null

  const moments: CloudAISuggestionRequest['moments'] = []
  const sourceIDs = new Set<string>()
  for (const entry of value.moments) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const moment = entry as Record<string, unknown>
    const id = typeof moment.id === 'string' ? moment.id.trim() : ''
    if (!id || id.length > 128 || sourceIDs.has(id) ||
        typeof moment.note !== 'string' || moment.note.length > 2_000 ||
        (moment.placeName !== undefined && (typeof moment.placeName !== 'string' || moment.placeName.length > 160)) ||
        (moment.locality !== undefined && (typeof moment.locality !== 'string' || moment.locality.length > 160))) return null

    sourceIDs.add(id)
    moments.push({
      id,
      note: moment.note.trim(),
      ...(typeof moment.placeName === 'string' && moment.placeName.trim()
        ? { placeName: moment.placeName.trim() }
        : {}),
      ...(typeof moment.locality === 'string' && moment.locality.trim()
        ? { locality: moment.locality.trim() }
        : {}),
    })
  }

  const title = typeof value.journeyTitle === 'string' && value.journeyTitle.trim()
    ? value.journeyTitle.trim()
    : 'Travel journal'
  return {
    journeyTitle: title,
    journeySummary: typeof value.journeySummary === 'string' ? value.journeySummary.trim() : '',
    moments,
  }
}

export function hasOversizedAIRequest(contentLength: string | null, actualBytes?: number) {
  if (actualBytes !== undefined && actualBytes > MAX_AI_REQUEST_BYTES) return true
  if (!contentLength) return false
  const declaredBytes = Number(contentLength)
  return Number.isFinite(declaredBytes) && declaredBytes > MAX_AI_REQUEST_BYTES
}

/** Read chunked requests without first allocating an unbounded string. */
export async function readBoundedAIRequestBody(request: Request) {
  if (hasOversizedAIRequest(request.headers.get('content-length'))) return null
  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_AI_REQUEST_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}
