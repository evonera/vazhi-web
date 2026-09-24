import type { PlaceSearchResult, PublicAskRequest, PublicListing, PublicProfile, RecommendationSubmission } from './contracts'
import { convexHTTPURL } from './convexConfig'

const apiOrigin = convexHTTPURL

export function requestHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return headers
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiOrigin) {
    throw new Error('This Vazhi link is not connected to its server yet.')
  }

  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: requestHeaders(init),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message ?? 'Something went wrong. Please try again.')
  }
  return response.json() as Promise<T>
}

// Public writes/searches use the same origin so Cloudflare can verify
// Turnstile, derive an opaque edge rate key, and sign the untouched body.
async function publicIngress<T>(
  path: '/api/recommendations' | '/api/reports' | '/places/search',
  init: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: requestHeaders(init),
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
  getListing(handle: string, slug: string, versionNumber?: number) {
    const version = versionNumber === undefined ? '' : `&version=${encodeURIComponent(String(versionNumber))}`
    return request<PublicListing>(`/api/listing?handle=${encodeURIComponent(handle)}&slug=${encodeURIComponent(slug)}${version}`)
  },
  reportListing(listingSlug: string, reason: string, detail?: string) {
    return publicIngress<{ accepted: true }>('/api/reports', {
      method: 'POST', body: JSON.stringify({ listingSlug, reason, detail }),
    })
  },
}
