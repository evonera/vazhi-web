import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import { authComponent, createAuth } from './betterAuth/auth'
import { parseRevenueCatWebhook, verifyRevenueCatWebhookSignature } from '../src/lib/revenuecatWebhook'
import { identifiedWebPurchaseLink } from '../src/lib/webPurchaseLink'
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
  // Unknown deployments fail closed. A predictable local salt is acceptable
  // only for the explicitly marked development deployment.
  const forwarded = request.headers.get('x-vazhi-rate-key')
  if (forwarded && /^[a-f0-9]{64}$/i.test(forwarded)) return forwarded
  const salt = developmentIngressSalt(process.env.VAZHI_ENVIRONMENT, process.env.RATE_LIMIT_SALT)
  if (!salt) throw new Error('Public ingress is not configured.')
  return opaqueRateLimitKey(request.headers.get('cf-connecting-ip'), salt)
}

async function requireOwnerAuthUserId(ctx: ActionCtx) {
  const user = await authComponent.getAuthUser(ctx)
  // A one-time, self-service bridge preserves rows written before owner IDs
  // moved from the custom-JWT token identifier to Better Auth user IDs. The
  // legacy value comes from Convex's verified current identity—not a client
  // supplied header/body—and the migration is idempotent.
  const legacyTokenIdentifier = (await ctx.auth.getUserIdentity())?.tokenIdentifier
  if (legacyTokenIdentifier) {
    await ctx.runMutation(internal.migrations.claimLegacyAskData, {
      ownerAuthUserId: String(user._id),
      legacyTokenIdentifier,
    })
  }
  return String(user._id)
}

async function hasVerifiedPublicIngress(request: Request, rawBody: string) {
  const signingSecret = process.env.EDGE_INGRESS_SIGNING_SECRET
  // Production and preview must receive a signed write from the Worker. The
  // development deployment is the only environment allowed to exercise a
  // direct local request before edge secrets are provisioned.
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
  const result = await ctx.runQuery(internal.listings.getPublicListing, {
    handle: url.searchParams.get('handle') ?? '', slug: url.searchParams.get('slug') ?? '',
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
  if (!await hasVerifiedPublicIngress(request, rawBody)) return json({ message: 'Please complete the verification and try again.' }, 400)
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

http.route({ path: '/api/reports', method: 'POST', handler: httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  if (!await hasVerifiedPublicIngress(request, rawBody)) return json({ message: 'Please complete the verification and try again.' }, 400)
  try {
    const input = JSON.parse(rawBody) as Record<string, unknown>
    await ctx.runMutation(internal.listings.reportPublicListing, {
      listingSlug: typeof input.listingSlug === 'string' ? input.listingSlug : '',
      reason: typeof input.reason === 'string' ? input.reason : '',
      detail: typeof input.detail === 'string' ? input.detail : undefined,
      rateLimitKey: await requestBucket(request),
    })
  } catch { /* Return a generic receipt; reports are not an existence oracle. */ }
  return json({ accepted: true })
}) })

// Configure the signing secret in the RevenueCat dashboard and as a Convex
// deployment environment variable before registering this endpoint. It fails
// closed while unconfigured, and authenticates the untouched raw JSON before
// parsing it. A receipt is a support/quota projection—not entitlement state.
http.route({ path: '/webhooks/revenuecat', method: 'POST', handler: httpAction(async (ctx, request) => {
  const signingSecret = process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET
  if (!signingSecret) return json({ message: 'Webhook endpoint is not configured.' }, 503)

  const rawBody = await request.text()
  const isAuthentic = await verifyRevenueCatWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get('x-revenuecat-webhook-signature'),
    signingSecret,
  })
  if (!isAuthentic) return json({ message: 'Webhook signature is invalid.' }, 401)

  const event = parseRevenueCatWebhook(rawBody)
  if (!event) return json({ message: 'Webhook payload is invalid.' }, 400)

  try {
    await ctx.runMutation(internal.providerEvents.recordRevenueCat, event)
    return json({ accepted: true })
  } catch {
    // A non-2xx response makes RevenueCat retry this event. Event ID
    // deduplication ensures a later delivery is safe.
    return json({ message: 'Webhook receipt is temporarily unavailable.' }, 503)
  }
}) })

// The authenticated Better Auth user ID is the same opaque RevenueCat App User
// ID used by iOS. Never accept an ID or destination URL from the browser.
// Only the production link is exposed here; sandbox checkout is not public.
http.route({ path: '/api/owner/pro-purchase-link', method: 'GET', handler: httpAction(async (ctx) => {
  let ownerAuthUserId: string
  try {
    ownerAuthUserId = await requireOwnerAuthUserId(ctx)
  } catch {
    return json({ message: 'Sign in to continue to checkout.' }, 401)
  }
  const url = identifiedWebPurchaseLink(process.env.REVENUECAT_WEB_PURCHASE_LINK_PRODUCTION, ownerAuthUserId)
  if (!url) return json({ message: 'Web checkout is not available yet. Use the iPhone app for Vazhi Pro.' }, 503)
  return new Response(JSON.stringify({ url }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': process.env.SITE_URL ?? '',
      'vary': 'Origin',
    },
  })
}) })

http.route({ path: '/api/owner/pro-purchase-link', method: 'OPTIONS', handler: httpAction(async () => new Response(null, { headers: {
  'access-control-allow-origin': process.env.SITE_URL ?? '',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization',
  'vary': 'Origin',
} })) })

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
      ownerAuthUserId, listingId: typeof input.listingID === 'string' ? input.listingID : '',
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
    await ctx.runMutation(internal.requests.setRecommendationStatusForOwner, {
      ownerAuthUserId,
      recommendationId: typeof input.recommendationID === 'string' ? input.recommendationID : '',
      status: input.status,
    } as never)
    return json({ updated: true })
  } catch {
    // Do not distinguish a foreign recommendation from a malformed one.
    return json({ message: 'That recommendation could not be updated.' }, 404)
  }
}) })

// This is intentionally separate from public recommendation endpoints. It
// requires the owner's custom-JWT session and forwards only the text fields
// the native client selected in its per-request consent sheet.
http.route({ path: '/api/ai/suggestions', method: 'POST', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as Record<string, unknown>
    const moments = Array.isArray(input.moments) ? input.moments : []
    const result = await ctx.runAction(internal.ai.generateSuggestions, {
      ownerAuthUserId,
      journeyTitle: typeof input.journeyTitle === 'string' ? input.journeyTitle : '',
      journeySummary: typeof input.journeySummary === 'string' ? input.journeySummary : '',
      moments: moments.map((entry) => {
        const moment = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        return {
          id: typeof moment.id === 'string' ? moment.id : '',
          capturedAt: typeof moment.capturedAt === 'number' ? moment.capturedAt : 0,
          note: typeof moment.note === 'string' ? moment.note : '',
          placeName: typeof moment.placeName === 'string' ? moment.placeName : undefined,
          locality: typeof moment.locality === 'string' ? moment.locality : undefined,
        }
      }),
    })
    return json(result)
  } catch {
    // Avoid logging or reflecting user-selected private text. The native app
    // keeps the original Moment untouched and presents this generic outcome.
    return json({ message: 'Cloud intelligence is temporarily unavailable. Your journal was not changed.' }, 503)
  }
}) })

http.route({ path: '/places/search', method: 'POST', handler: httpAction(async (ctx, request) => {
  const input = await request.json() as { query?: string; slug?: string }
  try {
    const { destination } = await ctx.runMutation(internal.requests.preparePublicPlaceSearch, {
      slug: input.slug ?? '', rateLimitKey: await requestBucket(request),
    })
    const result = await ctx.runAction(internal.places.search, { query: input.query ?? '', destination })
    return json(result)
  } catch {
    return json({ message: 'Place search is temporarily unavailable.' }, 503)
  }
}) })

http.route({ path: '/places/autocomplete', method: 'POST', handler: httpAction(async (ctx, request) => {
  const input = await request.json() as { input?: string; destination?: string }
  try {
    return json(await ctx.runAction(internal.places.autocomplete, { input: input.input ?? '', destination: input.destination }))
  } catch {
    return json({ message: 'Place suggestions are temporarily unavailable.' }, 503)
  }
}) })

http.route({ path: '/places/details', method: 'POST', handler: httpAction(async (ctx, request) => {
  const input = await request.json() as { placeID?: string }
  try {
    return json(await ctx.runAction(internal.places.details, { placeID: input.placeID ?? '' }))
  } catch {
    return json({ message: 'Place details are temporarily unavailable.' }, 503)
  }
}) })

http.route({ path: '/api/owner/routes', method: 'POST', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as { requestID?: string; stops?: Array<{ latitude?: number; longitude?: number }>; travelMode?: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT' }
    await ctx.runQuery(internal.requests.assertRequestOwner, { ownerAuthUserId, requestId: input.requestID ?? '' } as never)
    const stops = (input.stops ?? []).flatMap((stop) => typeof stop.latitude === 'number' && typeof stop.longitude === 'number' ? [{ latitude: stop.latitude, longitude: stop.longitude }] : [])
    const travelMode = input.travelMode ?? 'DRIVE'
    return json(await ctx.runAction(internal.routes.compute, { stops, travelMode }))
  } catch {
    return json({ message: 'This route is unavailable. You can still edit your Path.' }, 400)
  }
}) })

// Low-priority, post-edit refresh only. Never use this queue for route
// creation, map search, or anything that needs an immediate response.
http.route({ path: '/api/owner/routes/refresh', method: 'POST', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const input = await request.json() as { requestID?: string; idempotencyKey?: string; stops?: Array<{ latitude?: number; longitude?: number }>; travelMode?: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT' }
    await ctx.runQuery(internal.requests.assertRequestOwner, { ownerAuthUserId, requestId: input.requestID ?? '' } as never)
    const stops = (input.stops ?? []).flatMap((stop) => typeof stop.latitude === 'number' && typeof stop.longitude === 'number' ? [{ latitude: stop.latitude, longitude: stop.longitude }] : [])
    if (stops.length < 2 || stops.length > 25 || !input.idempotencyKey || input.idempotencyKey.length > 128) {
      return json({ message: 'That refresh request is invalid.' }, 400)
    }
    return json(await ctx.runMutation(internal.background.enqueueRouteSnapshotRefresh, {
      ownerAuthUserId, idempotencyKey: input.idempotencyKey, stops, travelMode: input.travelMode ?? 'DRIVE',
    }))
  } catch {
    return json({ message: 'This route refresh is unavailable. You can still edit your Path.' }, 400)
  }
}) })

http.route({ path: '/api/recommendations', method: 'OPTIONS', handler: httpAction(async () => new Response(null, { headers: { 'access-control-allow-origin': process.env.SITE_URL ?? '', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'vary': 'Origin' } })) })

export default http
