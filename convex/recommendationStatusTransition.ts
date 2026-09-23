export type RecommendationStatus = 'pending' | 'accepted' | 'ignored'

/** True only when a pending item leaves the pending state. */
export function leavesPendingState(previous: RecommendationStatus, next: RecommendationStatus) {
  return previous === 'pending' && next !== 'pending'
}
