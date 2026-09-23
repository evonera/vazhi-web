import type { PlaceSearchResult, PublicAskRequest, PublicListing, PublicProfile, RecommendationSubmission } from './contracts'

const apiOrigin = import.meta.env.VITE_CONVEX_HTTP_URL?.replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiOrigin) {
    throw new Error('This Vazhi link is not connected to its server yet.')
  }

  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message ?? 'Something went wrong. Please try again.')
  }
  return response.json() as Promise<T>
}

export const publicAskAPI = {
  getRequest(slug: string) {
    return request<PublicAskRequest>(`/api/ask?slug=${encodeURIComponent(slug)}`)
  },
  searchPlaces(query: string, destination: string) {
    return request<PlaceSearchResult[]>('/places/search', {
      method: 'POST',
      body: JSON.stringify({ query, destination }),
    })
  },
  submit(slug: string, submission: RecommendationSubmission) {
    return request<{ accepted: true }>('/api/recommendations', {
      method: 'POST',
      body: JSON.stringify({ slug, ...submission }),
    })
  },
}

export const publicGuideAPI = {
  getProfile(handle: string) {
    return request<PublicProfile>(`/api/profile?handle=${encodeURIComponent(handle)}`)
  },
  getListing(handle: string, slug: string, versionNumber?: number) {
    const version = versionNumber === undefined ? '' : `&version=${encodeURIComponent(String(versionNumber))}`
    return request<PublicListing>(`/api/listing?handle=${encodeURIComponent(handle)}&slug=${encodeURIComponent(slug)}${version}`)
  },
  reportListing(listingSlug: string, reason: string, detail?: string) {
    return request<{ accepted: true }>('/api/reports', {
      method: 'POST', body: JSON.stringify({ listingSlug, reason, detail }),
    })
  },
}
