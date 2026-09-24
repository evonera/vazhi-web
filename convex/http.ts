import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { authComponent, createAuth } from './betterAuth/auth'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth, { cors: true })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': process.env.SITE_URL ?? '', 'vary': 'Origin' } })
}

function escapeXML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

async function requestBucket(request: Request) {
  const input = `${process.env.RATE_LIMIT_SALT ?? 'development-only'}:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function ownerTokenIdentifier(ctx: { auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Sign in required.')
  return identity.tokenIdentifier
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

http.route({ path: '/api/owner/ask-requests', method: 'POST', handler: httpAction(async (ctx, request) => {
  try {
    const input = await request.json() as Record<string, unknown>
    const ownerTokenIdentifier = await ownerTokenIdentifier(ctx)
    const result = await ctx.runMutation(internal.requests.createForOwner, {
      ownerTokenIdentifier,
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

http.route({ path: '/api/owner/ask-requests', method: 'GET', handler: httpAction(async (ctx) => {
  try {
    const ownerTokenIdentifier = await ownerTokenIdentifier(ctx)
    return json(await ctx.runQuery(internal.requests.listForOwner, { ownerTokenIdentifier }))
  } catch {
    return json({ message: 'Sign in to view your requests.' }, 401)
  }
}) })

http.route({ path: '/api/owner/ask-requests', method: 'PATCH', handler: httpAction(async (ctx, request) => {
  try {
    const ownerTokenIdentifier = await ownerTokenIdentifier(ctx)
    const input = await request.json() as Record<string, unknown>
    await ctx.runMutation(internal.requests.setRequestStatusForOwner, {
      ownerTokenIdentifier,
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
    const ownerTokenIdentifier = await ownerTokenIdentifier(ctx)
    const requestId = new URL(request.url).searchParams.get('requestID') ?? ''
    const result = await ctx.runQuery(internal.requests.listRecommendationsForOwner, { ownerTokenIdentifier, requestId } as never)
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
      submittedAt: recommendation.submittedAt,
    })))
  } catch {
    return json({ message: 'Recommendations are unavailable.' }, 404)
  }
}) })

http.route({ path: '/api/owner/recommendations', method: 'PATCH', handler: httpAction(async (ctx, request) => {
  try {
    const input = await request.json() as Record<string, unknown>
    const ownerTokenIdentifier = await ownerTokenIdentifier(ctx)
    await ctx.runMutation(internal.requests.setRecommendationStatusForOwner, {
      ownerTokenIdentifier,
      recommendationId: typeof input.recommendationID === 'string' ? input.recommendationID : '',
      status: input.status,
    } as never)
    return json({ updated: true })
  } catch {
    // Do not distinguish a foreign recommendation from a malformed one.
    return json({ message: 'That recommendation could not be updated.' }, 404)
  }
}) })

http.route({ path: '/api/recommendations', method: 'OPTIONS', handler: httpAction(async () => new Response(null, { headers: { 'access-control-allow-origin': process.env.SITE_URL ?? '', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'vary': 'Origin' } })) })

export default http
