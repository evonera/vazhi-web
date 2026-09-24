export type AcceptedRecommendationOrderKey = {
  acceptanceOrder?: number
  acceptedAt?: number
  submittedAt: number
}

export const MAX_PATH_STOPS = 100

export function hasPathStopCapacity(acceptedCount: number): boolean {
  return acceptedCount < MAX_PATH_STOPS
}

export function orderAcceptedRecommendations<T extends AcceptedRecommendationOrderKey>(recommendations: T[]): T[] {
  return [...recommendations].sort((left, right) => {
    if (left.acceptanceOrder !== undefined && right.acceptanceOrder !== undefined && left.acceptanceOrder !== right.acceptanceOrder) {
      return left.acceptanceOrder - right.acceptanceOrder
    }
    const timeOrder = (left.acceptedAt ?? left.submittedAt) - (right.acceptedAt ?? right.submittedAt)
    if (timeOrder !== 0) return timeOrder
    return left.submittedAt - right.submittedAt
  })
}
