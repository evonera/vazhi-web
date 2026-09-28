import type { RecommendationSubmission } from './contracts'

type Content = Pick<RecommendationSubmission,
  'anonymous' | 'contributorName' | 'contributorHandle' | 'category' | 'place' | 'note' | 'referenceURL'>

const pending = new Map<string, { id: string; contentHash: string }>()
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validClientSubmissionID(value: string): boolean {
  return uuidV4.test(value)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Fingerprint only the recommendation content, never a one-use Turnstile token. */
export function recommendationContent(content: Content): string {
  const place = content.place
  // Google Place IDs may be retained; returned names, coordinates, addresses,
  // and types may not be smuggled into a durable receipt, even as a digest.
  const placeIdentity = place.provider === 'google'
    ? [place.provider, place.providerPlaceID?.trim() ?? '']
    : [place.provider, place.name.trim(), place.address?.trim() ?? '',
        place.latitude, place.longitude, place.primaryType?.trim() ?? '']
  return JSON.stringify([
    content.anonymous,
    content.anonymous ? '' : content.contributorName?.trim() ?? '',
    content.anonymous ? '' : content.contributorHandle?.trim() ?? '',
    content.category,
    placeIdentity,
    content.note.trim(), content.referenceURL?.trim() ?? '',
  ])
}

export function recommendationContentHash(content: Content): Promise<string> {
  return sha256Hex(recommendationContent(content))
}

function storageKey(slug: string): string {
  return `vazhi:ask-submission:${slug}`
}

function readPending(slug: string): { id: string; contentHash: string } | null {
  const cached = pending.get(slug)
  if (cached) return cached
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(slug)) ?? 'null')
    if (!stored || typeof stored !== 'object') return null
    const value = stored as Record<string, unknown>
    if (typeof value.id !== 'string' || !validClientSubmissionID(value.id) ||
        typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)) return null
    return { id: value.id, contentHash: value.contentHash }
  } catch {
    return null
  }
}

/** A lost response keeps the same ID; changing the draft creates a new attempt. */
export async function pendingRecommendationID(slug: string, content: Content): Promise<string> {
  const contentHash = await recommendationContentHash(content)
  const previous = readPending(slug)
  if (previous?.contentHash === contentHash) return previous.id
  const next = { id: crypto.randomUUID(), contentHash }
  pending.set(slug, next)
  try { sessionStorage.setItem(storageKey(slug), JSON.stringify(next)) } catch { /* Memory still covers this tab. */ }
  return next.id
}

export function clearPendingRecommendationID(slug: string, id: string): void {
  if (readPending(slug)?.id !== id) return
  pending.delete(slug)
  try { sessionStorage.removeItem(storageKey(slug)) } catch { /* No durable cache to remove. */ }
}
