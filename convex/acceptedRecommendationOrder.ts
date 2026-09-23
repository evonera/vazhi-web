export type AcceptedRecommendationOrderKey = {
  acceptedAt?: number
  submittedAt: number
}

export function orderAcceptedRecommendations<T extends AcceptedRecommendationOrderKey>(recommendations: T[]): T[] {
  return [...recommendations].sort((left, right) => {
    const timeOrder = (left.acceptedAt ?? left.submittedAt) - (right.acceptedAt ?? right.submittedAt)
    if (timeOrder !== 0) return timeOrder
    return left.submittedAt - right.submittedAt
  })
}
