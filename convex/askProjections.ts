/**
 * Explicit response boundaries for Ask the Way. Public request payloads are
 * deliberately assembled here instead of spreading database records across
 * HTTP handlers, making private owner metadata difficult to leak by accident.
 */
type AskRequestSource = {
  id: string
  localJourneyID?: string
  slug: string
  prompt: string
  destination: string
  journeyTitle?: string
  status: 'open' | 'closed'
  createdAt: number
  recommendationCount: number
}

export function toPublicAskRequest(request: Pick<AskRequestSource, 'slug' | 'prompt' | 'destination' | 'journeyTitle' | 'status'>) {
  return {
    slug: request.slug,
    prompt: request.prompt,
    destination: request.destination,
    journeyTitle: request.journeyTitle,
    status: request.status,
  }
}

export function toOwnerAskRequest(request: AskRequestSource) {
  return {
    id: request.id,
    localJourneyID: request.localJourneyID,
    slug: request.slug,
    prompt: request.prompt,
    destination: request.destination,
    status: request.status,
    createdAt: request.createdAt,
    recommendationCount: request.recommendationCount,
  }
}
