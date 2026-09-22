export const recommendationCategories = [
  'food',
  'hidden_spot',
  'stay',
  'culture',
  'nature',
  'avoid',
  'other',
] as const

export type RecommendationCategory = (typeof recommendationCategories)[number]

export type PublicAskRequest = {
  slug: string
  prompt: string
  destination: string
  journeyTitle?: string
  status: 'open' | 'closed'
}

export type Place = {
  provider: 'google' | 'manual'
  providerPlaceID?: string
  name: string
  address?: string
  latitude: number
  longitude: number
  primaryType?: string
}

export type RecommendationSubmission = {
  anonymous: boolean
  contributorName?: string
  contributorHandle?: string
  category: RecommendationCategory
  place: Place
  note: string
  referenceURL?: string
  turnstileToken?: string
}

export type PlaceSearchResult = Place

export const categoryLabel: Record<RecommendationCategory, string> = {
  food: 'Food',
  hidden_spot: 'Hidden spot',
  stay: 'Stay',
  culture: 'Culture',
  nature: 'Nature',
  avoid: 'Avoid',
  other: 'Other',
}

export function isSafeReferenceURL(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
