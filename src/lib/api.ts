import type { PlaceSearchResult, PublicAskRequest, RecommendationSubmission } from './contracts'
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

// Public writes/searches use the same origin so Cloudflare can verify
// Turnstile, derive an opaque edge rate key, and sign the untouched body.
async function publicIngress<T>(
  path: '/api/recommendations' | '/places/search',
  init: RequestInit,
): Promise<T> {
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
