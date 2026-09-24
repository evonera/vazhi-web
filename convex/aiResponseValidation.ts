export const MAX_AI_SUGGESTIONS = 3
export const MAX_AI_PROVIDER_RESPONSE_BYTES = 128 * 1024

export type AISourceMoment = {
  id: string
  note: string
  placeName?: string
  locality?: string
}

export type AISuggestion = {
  title: string
  tags: string[]
  summary: string
  friendTip: string
  confidence: number
  sourceMomentIDs: string[]
  modelVersion: string
}

type RawSuggestion = {
  title?: unknown
  tags?: unknown
  summary?: unknown
  friendTip?: unknown
  confidence?: unknown
  sourceMomentIDs?: unknown
}

function boundedString(value: unknown, maximum: number, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum) return null
  const normalized = value.trim()
  return normalized || allowEmpty ? normalized : null
}

/** Validate locally even when the provider claims to enforce JSON Schema. */
export function validateAISuggestions(
  value: unknown,
  sources: AISourceMoment[],
  model: string,
): AISuggestion[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rawSuggestions = (value as { suggestions?: unknown }).suggestions
  if (!Array.isArray(rawSuggestions) || rawSuggestions.length === 0 || rawSuggestions.length > MAX_AI_SUGGESTIONS) return null

  const knownSourceIDs = new Set(sources.map(({ id }) => id))
  const suggestions: AISuggestion[] = []
  for (const rawValue of rawSuggestions) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null
    const raw = rawValue as RawSuggestion
    const title = boundedString(raw.title, 120)
    const summary = boundedString(raw.summary, 600)
    const friendTip = boundedString(raw.friendTip, 300, true)
    if (!title || !summary || friendTip === null ||
        typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) ||
        raw.confidence < 0 || raw.confidence > 1 ||
        !Array.isArray(raw.tags) || raw.tags.length > 6 ||
        !Array.isArray(raw.sourceMomentIDs) || raw.sourceMomentIDs.length === 0 ||
        raw.sourceMomentIDs.length > 20) return null

    const tags: string[] = []
    const tagKeys = new Set<string>()
    for (const value of raw.tags) {
      const tag = boundedString(value, 32)
      if (!tag) return null
      const key = tag.toLocaleLowerCase('en-US')
      if (!tagKeys.has(key)) {
        tagKeys.add(key)
        tags.push(tag)
      }
    }

    const sourceMomentIDs: string[] = []
    const seenSourceIDs = new Set<string>()
    for (const value of raw.sourceMomentIDs) {
      if (typeof value !== 'string' || !knownSourceIDs.has(value)) return null
      if (!seenSourceIDs.has(value)) {
        seenSourceIDs.add(value)
        sourceMomentIDs.push(value)
      }
    }
    if (sourceMomentIDs.length === 0) return null

    suggestions.push({
      title,
      tags,
      summary,
      friendTip,
      confidence: raw.confidence,
      sourceMomentIDs,
      modelVersion: `cloud:${model}`,
    })
  }
  return suggestions
}

export async function readBoundedProviderBody(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AI_PROVIDER_RESPONSE_BYTES) return null
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_AI_PROVIDER_RESPONSE_BYTES) {
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
