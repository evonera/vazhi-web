import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { authComponent, createAuth } from './betterAuth/auth'
import { matchesModeratorToken } from './moderationAuth'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import type { DataModel } from './_generated/dataModel'
import { parseNativePlaceSearchInput } from '../src/lib/nativePlaceSearch'
import { toNativePlace } from '../src/lib/nativePlaceProjection'
import { developmentIngressSalt, opaqueRateLimitKey } from '../src/lib/publicIngress'
import { verifyEdgeIngressSignature } from '../src/lib/edgeIngressSignature'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth, { cors: true })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': process.env.SITE_URL ?? '', 'vary': 'Origin' } })
}

function escapeXML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

async function requestBucket(request: Request) {
  const forwarded = request.headers.get('x-vazhi-rate-key')
  if (forwarded && /^[a-f0-9]{64}$/i.test(forwarded)) return forwarded
  const salt = developmentIngressSalt(process.env.VAZHI_ENVIRONMENT, process.env.RATE_LIMIT_SALT)
  if (!salt) throw new Error('Public ingress is not configured.')
  return opaqueRateLimitKey(request.headers.get('cf-connecting-ip'), salt)
}

async function requireOwnerAuthUserId(ctx: GenericCtx<DataModel>) {
  const user = await authComponent.getAuthUser(ctx)
  return String(user._id)
}

async function hasVerifiedPublicIngress(request: Request, rawBody: string) {
  const signingSecret = process.env.EDGE_INGRESS_SIGNING_SECRET
  if (!signingSecret) return process.env.VAZHI_ENVIRONMENT === 'development'
  return verifyEdgeIngressSignature({
    rawBody,
    signatureHeader: request.headers.get('x-vazhi-edge-signature'),
    signingSecret,
  })
}

http.route({ path: '/api/ask', method: 'GET', handler: httpAction(async (ctx, request) => {
  const slug = new URL(request.url).searchParams.get('slug') ?? ''
  const result = await ctx.runQuery(internal.requests.getPublicBySlug, { slug })
  return result ? json(result) : json({ message: 'This request is unavailable.' }, 404)
}) })

http.route({ path: '/api/profile', method: 'GET', handler: httpAction(async (ctx, request) => {
  const handle = new URL(request.url).searchParams.get('handle') ?? ''
  const result = await ctx.runQuery(internal.listings.getPublicProfileByHandle, { handle })
  return result ? json(result) : json({ message: 'This profile is unavailable.' }, 404)
}) })

http.route({ path: '/api/listing', method: 'GET', handler: httpAction(async (ctx, request) => {
  const url = new URL(request.url)
  const requestedVersion = url.searchParams.get('version')
  const parsedVersion = requestedVersion === null ? undefined : Number(requestedVersion)
  if (requestedVersion !== null && (!Number.isSafeInteger(parsedVersion) || (parsedVersion ?? 0) <= 0)) {
    return json({ message: 'This guide version is unavailable.' }, 404)
  }
  const result = await ctx.runQuery(internal.listings.getPublicListing, {
    handle: url.searchParams.get('handle') ?? '', slug: url.searchParams.get('slug') ?? '',
    versionNumber: parsedVersion,
  })
  return result ? json(result) : json({ message: 'This guide is unavailable.' }, 404)
}) })

// A public, 9:16 story card built solely from the sanitised request projection.
http.route({ path: '/og/ask', method: 'GET', handler: httpAction(async (ctx, request) => {
  const slug = new URL(request.url).searchParams.get('slug') ?? ''
  const ask = await ctx.runQuery(internal.requests.getPublicBySlug, { slug })
  if (!ask) return new Response('Not found', { status: 404 })
  const prompt = escapeXML(ask.prompt.slice(0, 150))
  const destination = escapeXML(ask.destination.slice(0, 80))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#102d3b"/><circle cx="910" cy="250" r="330" fill="#1f6f9e" opacity=".7"/><text x="88" y="150" fill="#d8f2ff" font-family="Arial, sans-serif" font-size="42" font-weight="700">VAZHI · ASK THE WAY</text><text x="88" y="740" fill="white" font-family="Arial, sans-serif" font-size="82" font-weight="700">${prompt}</text><text x="88" y="1160" fill="#b5e6ff" font-family="Arial, sans-serif" font-size="52">For ${destination}</text><line x1="88" x2="992" y1="1450" y2="1450" stroke="#77c6eb" stroke-width="3"/><text x="88" y="1540" fill="white" font-family="Arial, sans-serif" font-size="55">Share a place worth their time.</text><text x="88" y="1780" fill="#b5e6ff" font-family="Arial, sans-serif" font-size="45">vazhi.app</text></svg>`
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300' } })
}) })

http.route({ path: '/api/recommendations', method: 'POST', handler: httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  if (!await hasVerifiedPublicIngress(request, rawBody)) {
    return json({ message: 'Please complete the verification and try again.' }, 400)
  }
  try {
    const input = JSON.parse(rawBody) as Record<string, unknown>
    await ctx.runMutation(internal.requests.submitPublic, {
      slug: typeof input.slug === 'string' ? input.slug : '',
      rateLimitKey: await requestBucket(request),
      anonymous: input.anonymous === true,
      contributorName: typeof input.contributorName === 'string' ? input.contributorName : undefined,
      contributorHandle: typeof input.contributorHandle === 'string' ? input.contributorHandle : undefined,
      category: input.category,
      place: input.place,
      note: input.note,
      referenceURL: typeof input.referenceURL === 'string' ? input.referenceURL : undefined,
    } as never)
    return json({ accepted: true })
  } catch {
    return json({ message: 'We could not add that recommendation. Check the form and try again.' }, 400)
  }
}) })

http.route({ path: '/places/search', method: 'POST', handler: httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  if (!await hasVerifiedPublicIngress(request, rawBody)) {
    return json({ message: 'Place search is temporarily unavailable.' }, 503)
  }
  try {
    const input = JSON.parse(rawBody) as { query?: string; slug?: string }
    const query = input.query?.trim() ?? ''
    if (query.length < 3 || query.length > 100) {
      return json({ message: 'Enter 3–100 characters to search.' }, 400)
    }
    const { destination } = await ctx.runMutation(internal.requests.preparePublicPlaceSearch, {
      slug: input.slug ?? '',
      rateLimitKey: await requestBucket(request),
    })
    return json(await ctx.runAction(internal.places.search, { query, destination }))
  } catch {
    return json({ message: 'Place search is temporarily unavailable.' }, 503)
  }
}) })

http.route({ path: '/api/reports', method: 'POST', handler: httpAction(async (ctx, request) => {
  const input = await request.json() as Record<string, unknown>
  try {
    await ctx.runMutation(internal.listings.reportPublicListing, {
      listingSlug: typeof input.listingSlug === 'string' ? input.listingSlug : '',
      reason: typeof input.reason === 'string' ? input.reason : '',
      detail: typeof input.detail === 'string' ? input.detail : undefined,
      rateLimitKey: await requestBucket(request),
    })
  } catch { /* Return a generic receipt; reports are not an existence oracle. */ }
  return json({ accepted: true })
}) })

// The moderation API is intentionally not part of the browser app. Operators
// call it from a trusted terminal/workflow using a server-only credential.
http.route({ path: '/api/admin/reports', method: 'GET', handler: httpAction(async (ctx, request) => {
  if (!matchesModeratorToken(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null, process.env.MODERATION_API_TOKEN)) {
    return json({ message: 'Not found.' }, 404)
  }
  return json(await ctx.runQuery(internal.listings.listModerationQueue, {}))
}) })

http.route({ path: '/api/admin/reports', method: 'PATCH', handler: httpAction(async (ctx, request) => {
  if (!matchesModeratorToken(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null, process.env.MODERATION_API_TOKEN)) {
    return json({ message: 'Not found.' }, 404)
  }
  try {
    const input = await request.json() as Record<string, unknown>
    await ctx.runMutation(internal.listings.resolveModerationReport, {
      reportId: typeof input.reportId === 'string' ? input.reportId : '',
      action: input.action,
      note: typeof input.note === 'string' ? input.note : undefined,
    } as never)
    return json({ updated: true })
  } catch {
    return json({ message: 'That report could not be updated.' }, 400)
  }
}) })

http.route({ path: '/api/owner/ask-requests', method: 'POST', handler: httpAction(async (ctx, request) => {
  try {
    const input = await request.json() as Record<string, unknown>
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const result = await ctx.runMutation(internal.requests.createForOwner, {
      ownerAuthUserId,
      localJourneyID: typeof input.localJourneyID === 'string' ? input.localJourneyID : '',
      title: typeof input.title === 'string' ? input.title : '',
      destination: typeof input.destination === 'string' ? input.destination : '',
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
    })
    return json(result, 201)
  } catch {
    return json({ message: 'We could not create that request. Check your sign-in and journey details.' }, 400)
  }
}) })

http.route({ path: '/api/owner/listings', method: 'POST', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as Record<string, unknown>
    const result = await ctx.runMutation(internal.listings.publishForOwner, {
      ownerAuthUserId,
      localPathID: typeof input.localPathID === 'string' ? input.localPathID : '',
      visibility: input.visibility,
      title: typeof input.title === 'string' ? input.title : '',
      subtitle: typeof input.subtitle === 'string' ? input.subtitle : '',
      disclaimer: typeof input.disclaimer === 'string' ? input.disclaimer : '',
      approximateLocations: input.approximateLocations === true,
      stops: Array.isArray(input.stops) ? input.stops : [],
    } as never)
    return json(result, 201)
  } catch {
    return json({ message: 'We could not publish that guide. Check your profile and privacy review.' }, 400)
  }
}) })

http.route({ path: '/api/owner/listings', method: 'PATCH', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as Record<string, unknown>
    await ctx.runMutation(internal.listings.archiveForOwner, {
      ownerAuthUserId, localPathID: typeof input.localPathID === 'string' ? input.localPathID : '',
    } as never)
    return json({ updated: true })
  } catch {
    return json({ message: 'That guide could not be unpublished.' }, 404)
  }
}) })

http.route({ path: '/api/owner/profile', method: 'GET', handler: httpAction(async (ctx) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    return json(await ctx.runQuery(internal.profiles.getForOwner, { ownerAuthUserId }))
  } catch { return json({ message: 'Sign in to manage your profile.' }, 401) }
}) })

http.route({ path: '/api/owner/profile', method: 'PUT', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as Record<string, unknown>
    await ctx.runMutation(internal.profiles.saveForOwner, {
      ownerAuthUserId,
      handle: typeof input.handle === 'string' ? input.handle : undefined,
      displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
      bio: typeof input.bio === 'string' ? input.bio : undefined,
      isPublic: input.isPublic === true,
    })
    return json({ updated: true })
  } catch { return json({ message: 'We could not save that profile.' }, 400) }
}) })

http.route({ path: '/api/owner/ask-requests', method: 'GET', handler: httpAction(async (ctx) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    return json(await ctx.runQuery(internal.requests.listForOwner, { ownerAuthUserId }))
  } catch {
    return json({ message: 'Sign in to view your requests.' }, 401)
  }
}) })

http.route({ path: '/api/owner/ask-requests', method: 'PATCH', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as Record<string, unknown>
    await ctx.runMutation(internal.requests.setRequestStatusForOwner, {
      ownerAuthUserId,
      requestId: typeof input.requestID === 'string' ? input.requestID : '',
      status: input.status,
    } as never)
    return json({ updated: true })
  } catch {
    return json({ message: 'That request could not be updated.' }, 404)
  }
}) })

http.route({ path: '/api/owner/recommendations', method: 'GET', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const requestId = new URL(request.url).searchParams.get('requestID') ?? ''
    const result = await ctx.runQuery(internal.requests.listRecommendationsForOwner, { ownerAuthUserId, requestId } as never)
    return json(result.map((recommendation) => ({
      id: recommendation._id,
      anonymous: recommendation.anonymous,
      contributorName: recommendation.contributorName,
      contributorHandle: recommendation.contributorHandle,
      category: recommendation.category,
      place: recommendation.place,
      note: recommendation.note,
      referenceURL: recommendation.referenceURL,
      status: recommendation.status,
      acceptedAt: recommendation.acceptedAt,
      acceptanceOrder: recommendation.acceptanceOrder,
      submittedAt: recommendation.submittedAt,
    })))
  } catch {
    return json({ message: 'Recommendations are unavailable.' }, 404)
  }
}) })

http.route({ path: '/api/owner/recommendations', method: 'PATCH', handler: httpAction(async (ctx, request) => {
  try {
    const input = await request.json() as Record<string, unknown>
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const acceptanceOrder = await ctx.runMutation(internal.requests.setRecommendationStatusForOwner, {
      ownerAuthUserId,
      recommendationId: typeof input.recommendationID === 'string' ? input.recommendationID : '',
      status: input.status,
    } as never)
    return json({ updated: true, acceptanceOrder })
  } catch {
    // Do not distinguish a foreign recommendation from a malformed one.
    return json({ message: 'That recommendation could not be updated.' }, 404)
  }
}) })

// Native owner search is authenticated and quota-limited before a billable
// Google request. Signed-out clients keep using Apple search or a manual pin.
http.route({ path: '/api/owner/places/search', method: 'POST', handler: httpAction(async (ctx, request) => {
  let ownerAuthUserId: string
  try {
    ownerAuthUserId = await requireOwnerAuthUserId(ctx)
  } catch {
    return json({ message: 'Sign in to search Google places.' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ message: 'Enter a place to search.' }, 400)
  }
  const input = parseNativePlaceSearchInput(body)
  if (!input) {
    return json({ message: 'Enter a 3–100 character place search and a valid Journey destination.' }, 400)
  }
  try {
    await ctx.runMutation(internal.placeLimits.consumeOwnerSearch, { ownerAuthUserId })
  } catch {
    return json({ message: 'Place search limit reached. Try again later.' }, 429)
  }
  try {
    const places = await ctx.runAction(internal.places.search, input)
    return json(places.map(toNativePlace))
  } catch {
    return json({ message: 'Place search is temporarily unavailable.' }, 503)
  }
}) })

http.route({ path: '/api/recommendations', method: 'OPTIONS', handler: httpAction(async () => new Response(null, { headers: { 'access-control-allow-origin': process.env.SITE_URL ?? '', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'vary': 'Origin' } })) })

export default http
