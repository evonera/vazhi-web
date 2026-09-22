import type { PlaceSearchResult, PublicAskRequest, PublicListing, PublicProfile, RecommendationSubmission } from './contracts'
import { convexHTTPURL } from './convexConfig'

const apiOrigin = convexHTTPURL

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

// Public ingress uses the website origin so the Cloudflare Worker can attach
// its server-only ingress signature. Submission routes also verify Turnstile;
// place search deliberately stays frictionless but must be signed the same
// way. Reads intentionally continue to use Convex public projection endpoints.
async function publicIngress<T>(path: '/api/recommendations' | '/api/reports' | '/places/search', init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
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
  searchPlaces(query: string, slug: string) {
    return publicIngress<PlaceSearchResult[]>('/places/search', {
      method: 'POST',
      body: JSON.stringify({ query, slug }),
    })
  },
  submit(slug: string, submission: RecommendationSubmission) {
    return publicIngress<{ accepted: true }>('/api/recommendations', {
      method: 'POST',
      body: JSON.stringify({ slug, ...submission }),
    })
  },
}

export const publicGuideAPI = {
  getProfile(handle: string) {
    return request<PublicProfile>(`/api/profile?handle=${encodeURIComponent(handle)}`)
  },
  getListing(handle: string, slug: string) {
    return request<PublicListing>(`/api/listing?handle=${encodeURIComponent(handle)}&slug=${encodeURIComponent(slug)}`)
  },
  reportListing(listingSlug: string, reason: string, detail?: string) {
    return publicIngress<{ accepted: true }>('/api/reports', {
      method: 'POST', body: JSON.stringify({ listingSlug, reason, detail }),
    })
  },
}
