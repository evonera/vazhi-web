export type AcceptedRecommendationOrderKey = {
  acceptedAt?: number
  submittedAt: number
}

export const MAX_PATH_STOPS = 100

export function hasPathStopCapacity(acceptedCount: number): boolean {
  return acceptedCount < MAX_PATH_STOPS
}

export function orderAcceptedRecommendations<T extends AcceptedRecommendationOrderKey>(recommendations: T[]): T[] {
  return [...recommendations].sort((left, right) => {
    const timeOrder = (left.acceptedAt ?? left.submittedAt) - (right.acceptedAt ?? right.submittedAt)
    if (timeOrder !== 0) return timeOrder
    return left.submittedAt - right.submittedAt
  })
}
