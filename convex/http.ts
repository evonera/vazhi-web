import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { authComponent, createAuth } from './betterAuth/auth'
import { matchesModeratorToken } from './moderationAuth'
import { opaqueEdgeRateLimitKey } from './rateLimitKey'
import { acceptPublicReport } from './publicReportReceipt'
import { parseModerationPagination } from './moderationPagination'
import { parseRouteRefreshInput } from './routeRefreshValidation'
import type { DataModel } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth, { cors: true })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': process.env.SITE_URL ?? '', 'vary': 'Origin' } })
}

function escapeXML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

async function requestBucket(request: Request) {
  return opaqueEdgeRateLimitKey(process.env.RATE_LIMIT_SALT, request.headers.get('cf-connecting-ip'), process.env.NODE_ENV === 'production')
}

async function requireOwnerAuthUserId(ctx: ActionCtx) {
  const user = await authComponent.getAuthUser(ctx)
  // A one-time, self-service bridge preserves rows written before owner IDs
  // moved from the custom-JWT token identifier to Better Auth user IDs. The
  // legacy value comes from Convex's verified current identity—not a client
  // supplied header/body—and the migration is idempotent.
  const legacyTokenIdentifier = (await ctx.auth.getUserIdentity())?.tokenIdentifier
  if (legacyTokenIdentifier) {
    // A bounded number of small transactions keeps normal owner requests
    // responsive while continuing larger legacy accounts over subsequent
    // requests. The total migration work per request is capped at 75 rows per
    // table; the next call advances from the remaining legacy-index rows.
    for (let pass = 0; pass < 3; pass += 1) {
      const migration = await ctx.runMutation(internal.migrations.claimLegacyAskData, {
        ownerAuthUserId: String(user._id),
        legacyTokenIdentifier,
      })
      if (!migration.hasMore) break
    }
  }
  return String(user._id)
}

async function verifyTurnstile(token: string | undefined, remoteIP: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return process.env.NODE_ENV !== 'production'
  if (!token) return false
  const form = new FormData()
  form.set('secret', secret)
  form.set('response', token)
  if (remoteIP) form.set('remoteip', remoteIP)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  return (await response.json() as { success?: boolean }).success === true
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
  const input = await request.json() as Record<string, unknown>
  const validChallenge = await verifyTurnstile(typeof input.turnstileToken === 'string' ? input.turnstileToken : undefined, request.headers.get('cf-connecting-ip'))
  if (!validChallenge) return json({ message: 'Please complete the verification and try again.' }, 400)
  try {
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
  const receipt = await acceptPublicReport(request, async (input) => {
    await ctx.runMutation(internal.listings.reportPublicListing, {
      listingSlug: typeof input.listingSlug === 'string' ? input.listingSlug : '',
      reason: typeof input.reason === 'string' ? input.reason : '',
      detail: typeof input.detail === 'string' ? input.detail : undefined,
      rateLimitKey: await requestBucket(request),
    })
  })
  return json(receipt)
}) })

// The moderation API is intentionally not part of the browser app. Operators
// call it from a trusted terminal/workflow using a server-only credential.
http.route({ path: '/api/admin/reports', method: 'GET', handler: httpAction(async (ctx, request) => {
  if (!matchesModeratorToken(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null, process.env.MODERATION_API_TOKEN)) {
    return json({ message: 'Not found.' }, 404)
  }
  const pagination = parseModerationPagination(new URL(request.url))
  return json(await ctx.runQuery(internal.listings.listModerationQueue, pagination))
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
      destination: typeof input.destination === 'string' ? input.destination : '',
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

http.route({ path: '/api/owner/listings', method: 'GET', handler: httpAction(async (ctx, request) => {
  try {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const localPathID = new URL(request.url).searchParams.get('localPathID') ?? ''
    const guide = await ctx.runQuery(internal.listings.getOwnerListing, { ownerAuthUserId, localPathID })
    return json({ guide })
  } catch {
    return json({ message: 'Sign in to view this guide.' }, 401)
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
  let ownerAuthUserId: string
  try {
    ownerAuthUserId = await requireOwnerAuthUserId(ctx)
  } catch {
    return json({ message: 'Sign in again to use cloud intelligence.' }, 401)
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > 64 * 1024) return json({ message: 'Select fewer or shorter notes.' }, 413)
  let input: Record<string, unknown>
  try {
    const body = await request.text()
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) return json({ message: 'Select fewer or shorter notes.' }, 413)
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ message: 'Check the selected notes and try again.' }, 400)
    input = parsed as Record<string, unknown>
  } catch {
    return json({ message: 'Check the selected notes and try again.' }, 400)
  }
  if (typeof input.journeyTitle !== 'string' || input.journeyTitle.trim().length === 0 || input.journeyTitle.length > 160 ||
      (input.journeySummary !== undefined && (typeof input.journeySummary !== 'string' || input.journeySummary.length > 1_000)) ||
      !Array.isArray(input.moments) || input.moments.length === 0 || input.moments.length > 20) {
    return json({ message: 'Select between 1 and 20 valid notes.' }, 400)
  }
  const moments: Array<{ id: string; capturedAt: number; note: string; placeName?: string; locality?: string }> = []
  for (const entry of input.moments) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return json({ message: 'One selected note is invalid.' }, 400)
    const moment = entry as Record<string, unknown>
    if (typeof moment.id !== 'string' || moment.id.length === 0 || moment.id.length > 128 ||
        typeof moment.capturedAt !== 'number' || !Number.isFinite(moment.capturedAt) ||
        typeof moment.note !== 'string' || moment.note.length > 2_000 ||
        (moment.placeName !== undefined && (typeof moment.placeName !== 'string' || moment.placeName.length > 160)) ||
        (moment.locality !== undefined && (typeof moment.locality !== 'string' || moment.locality.length > 160))) {
      return json({ message: 'One selected note is invalid.' }, 400)
    }
    moments.push({ id: moment.id, capturedAt: moment.capturedAt, note: moment.note, placeName: moment.placeName as string | undefined, locality: moment.locality as string | undefined })
  }
  try {
    const result = await ctx.runAction(internal.ai.generateSuggestions, {
      ownerAuthUserId,
      journeyTitle: input.journeyTitle,
      journeySummary: typeof input.journeySummary === 'string' ? input.journeySummary : '',
      moments,
    })
    if (result.kind === 'rate_limited') return json({ message: 'You have reached the cloud-intelligence limit. Try again later.' }, 429)
    return json({ suggestions: result.suggestions })
  } catch {
    // Keep private note text out of logs and responses; preserve an honest
    // provider/configuration failure without masking auth or input errors.
    return json({ message: 'Cloud intelligence is temporarily unavailable. Your journal was not changed.' }, 503)
  }
}) })

http.route({ path: '/places/search', method: 'POST', handler: httpAction(async (ctx, request) => {
  const input = await request.json() as { query?: string; destination?: string }
  try {
    const result = await ctx.runAction(internal.places.search, { query: input.query ?? '', destination: input.destination ?? '' })
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
  let ownerAuthUserId: string
  try {
    ownerAuthUserId = await requireOwnerAuthUserId(ctx)
  } catch {
    return json({ message: 'Sign in again to refresh this route.' }, 401)
  }
  let raw: unknown
  try { raw = await request.json() } catch { return json({ message: 'That refresh request is invalid.' }, 400) }
  const input = parseRouteRefreshInput(raw)
  if (!input) return json({ message: 'That refresh request is invalid.' }, 400)
  try {
    await ctx.runQuery(internal.requests.assertRequestOwner, { ownerAuthUserId, requestId: input.requestID } as never)
  } catch {
    return json({ message: 'This route is unavailable for the current account.' }, 404)
  }
  try {
    const result = await ctx.runMutation(internal.background.enqueueRouteSnapshotRefresh, {
      ownerAuthUserId, idempotencyKey: input.idempotencyKey, stops: input.stops, travelMode: input.travelMode,
    })
    if (result.kind === 'rate_limited') return json({ message: 'Route refresh limit reached. You can still edit your Path.' }, 429)
    if (result.kind === 'queue_full') return json({ message: 'Route refresh queue is busy. You can still edit your Path.' }, 429)
    return json(result)
  } catch {
    return json({ message: 'Route refresh is unavailable. You can still edit your Path.' }, 503)
  }
}) })

http.route({ path: '/api/recommendations', method: 'OPTIONS', handler: httpAction(async () => new Response(null, { headers: { 'access-control-allow-origin': process.env.SITE_URL ?? '', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'vary': 'Origin' } })) })

export default http
