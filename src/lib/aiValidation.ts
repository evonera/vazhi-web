import { ConvexError } from 'convex/values'

type SourceMoment = {
  id: string
  capturedAt: number
  note: string
  placeName?: string
  locality?: string
}

type RawSuggestion = {
  title?: unknown
  tags?: unknown
  summary?: unknown
  friendTip?: unknown
  confidence?: unknown
  sourceMomentIDs?: unknown
}

export function validatedSuggestions(value: unknown, sources: SourceMoment[], model: string) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { suggestions?: unknown }).suggestions)) {
    throw new ConvexError('Cloud intelligence returned an invalid response.')
  }
  const sourceIDs = new Set(sources.map((source) => source.id))
  const rawSuggestions = (value as { suggestions: RawSuggestion[] }).suggestions
  if (rawSuggestions.length > 3) throw new ConvexError('Cloud intelligence returned too many suggestions.')
  return rawSuggestions.map((suggestion) => {
    const rawCitations = suggestion.sourceMomentIDs
    // Providers may repeat a valid citation. Bound the raw response first,
    // then deduplicate before enforcing the number of selected sources.
    const citations: unknown[] = Array.isArray(rawCitations) && rawCitations.length <= 100
      ? [...new Set(rawCitations)]
      : []
    const validCitations = citations.filter((id): id is string => typeof id === 'string' && sourceIDs.has(id))
    if (typeof suggestion.title !== 'string' || !suggestion.title.trim() ||
      typeof suggestion.summary !== 'string' || !suggestion.summary.trim() ||
      typeof suggestion.friendTip !== 'string' || !
      Array.isArray(suggestion.tags) || !suggestion.tags.every((tag) => typeof tag === 'string') ||
      typeof suggestion.confidence !== 'number' || suggestion.confidence < 0 || suggestion.confidence > 1 ||
      validCitations.length === 0 || validCitations.length !== citations.length ||
      validCitations.length > sources.length) {
      throw new ConvexError('Cloud intelligence returned an invalid response.')
    }
    return {
      title: suggestion.title.trim().slice(0, 120),
      tags: suggestion.tags.map((tag) => tag.trim().slice(0, 32)).filter(Boolean).slice(0, 6),
      summary: suggestion.summary.trim().slice(0, 600),
      friendTip: suggestion.friendTip.trim().slice(0, 300),
      confidence: suggestion.confidence,
      sourceMomentIDs: validCitations,
      modelVersion: `cloud:${model}`,
    }
  })
}
