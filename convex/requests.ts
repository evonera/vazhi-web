import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { RateLimiter, HOUR } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'
import { authComponent } from './betterAuth/auth'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import type { DataModel } from './_generated/dataModel'

const category = v.union(
  v.literal('food'), v.literal('hidden_spot'), v.literal('stay'),
  v.literal('culture'), v.literal('nature'), v.literal('avoid'), v.literal('other'),
)
const place = v.object({
  provider: v.union(v.literal('google'), v.literal('manual')),
  providerPlaceID: v.optional(v.string()), name: v.string(), address: v.optional(v.string()),
  latitude: v.number(), longitude: v.number(), primaryType: v.optional(v.string()),
})

// A short, transient bucket protects a public link without retaining an IP in
// Vazhi's product tables. The key is a salted one-way digest made in http.ts.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  publicRecommendation: {
    kind: 'token bucket',
    rate: 3,
    period: HOUR,
    capacity: 3,
  },
})

async function requireOwnerAuthUserId(ctx: GenericCtx<DataModel>) {
  const user = await authComponent.getAuthUser(ctx)
  return String(user._id)
}

function slug() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

function isHTTPSURL(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export const create = mutation({
  args: { localJourneyID: v.string(), title: v.string(), destination: v.string(), prompt: v.string(), startsAt: v.optional(v.number()), endsAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    if (!args.localJourneyID || !args.title.trim() || !args.destination.trim() || !args.prompt.trim()) throw new ConvexError('Add a title, destination, and question.')
    const existingJourney = await ctx.db.query('journeys').withIndex('by_ownerAuthUserId_and_localID', (q) => q.eq('ownerAuthUserId', ownerAuthUserId).eq('localID', args.localJourneyID)).unique()
    const now = Date.now()
    const journeyId = existingJourney?._id ?? await ctx.db.insert('journeys', { ownerAuthUserId, localID: args.localJourneyID, title: args.title, destination: args.destination, startsAt: args.startsAt, endsAt: args.endsAt, updatedAt: now })
    if (existingJourney) await ctx.db.patch(existingJourney._id, { title: args.title, destination: args.destination, startsAt: args.startsAt, endsAt: args.endsAt, updatedAt: now })
    const requestSlug = slug()
    const requestId = await ctx.db.insert('askRequests', { ownerAuthUserId, journeyId, slug: requestSlug, prompt: args.prompt, destination: args.destination, journeyTitle: args.title, status: 'open', createdAt: now })
    return { id: requestId, slug: requestSlug, status: 'open' as const }
  },
})

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    return ctx.db.query('askRequests').withIndex('by_ownerAuthUserId_and_createdAt', (q) => q.eq('ownerAuthUserId', ownerAuthUserId)).order('desc').take(50)
  },
})

/// A compact live projection for a Journey header/inbox badge. The query is
/// owner-scoped so it is safe to subscribe to from the authenticated native
/// client without exposing recommendation contents or contributor identity.
export const askStatsForJourney = query({
  args: { localJourneyID: v.string() },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const journey = await ctx.db.query('journeys')
      .withIndex('by_ownerAuthUserId_and_localID', (q) => q
        .eq('ownerAuthUserId', ownerAuthUserId).eq('localID', args.localJourneyID))
      .unique()
    if (!journey) return { openRequestCount: 0, recommendationCount: 0, pendingCount: 0 }
    const requests = await ctx.db.query('askRequests')
      .withIndex('by_journeyId_and_createdAt', (q) => q.eq('journeyId', journey._id))
      .collect()
    const recommendations = await Promise.all(requests.map((request) => ctx.db.query('recommendations')
      .withIndex('by_askRequestId_and_submittedAt', (q) => q.eq('askRequestId', request._id))
      .collect()))
    const flat = recommendations.flat()
    return {
      openRequestCount: requests.filter((request) => request.status === 'open').length,
      recommendationCount: flat.length,
      pendingCount: flat.filter((recommendation) => recommendation.status === 'pending').length,
    }
  },
})

export const setStatus = mutation({
  args: { requestId: v.id('askRequests'), status: v.union(v.literal('open'), v.literal('closed')) },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const request = await ctx.db.get(args.requestId)
    if (!request || request.ownerAuthUserId !== ownerAuthUserId) throw new ConvexError('Request not found.')
    await ctx.db.patch(request._id, { status: args.status, closedAt: args.status === 'closed' ? Date.now() : undefined })
    return null
  },
})

export const listRecommendations = query({
  args: { requestId: v.id('askRequests') },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const request = await ctx.db.get(args.requestId)
    if (!request || request.ownerAuthUserId !== ownerAuthUserId) throw new ConvexError('Request not found.')
    return ctx.db.query('recommendations').withIndex('by_askRequestId_and_submittedAt', (q) => q.eq('askRequestId', request._id)).order('desc').take(100)
  },
})

export const setRecommendationStatus = mutation({
  args: { recommendationId: v.id('recommendations'), status: v.union(v.literal('accepted'), v.literal('ignored')) },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const recommendation = await ctx.db.get(args.recommendationId)
    if (!recommendation) throw new ConvexError('Recommendation not found.')
    const request = await ctx.db.get(recommendation.askRequestId)
    if (!request || request.ownerAuthUserId !== ownerAuthUserId) throw new ConvexError('Recommendation not found.')
    await ctx.db.patch(recommendation._id, { status: args.status })
    return null
  },
})

export const createPathFromAccepted = mutation({
  args: { requestId: v.id('askRequests'), title: v.string() },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const request = await ctx.db.get(args.requestId)
    if (!request || request.ownerAuthUserId !== ownerAuthUserId) throw new ConvexError('Request not found.')
    const accepted = await ctx.db.query('recommendations').withIndex('by_askRequestId_and_status_and_submittedAt', (q) => q.eq('askRequestId', request._id).eq('status', 'accepted')).order('asc').take(100)
    if (accepted.length === 0) throw new ConvexError('Accept at least one recommendation first.')
    const pathId = await ctx.db.insert('paths', { ownerAuthUserId, journeyId: request.journeyId, title: args.title, status: 'draft', createdAt: Date.now() })
    for (const [orderIndex, recommendation] of accepted.entries()) {
      await ctx.db.insert('pathStops', { pathId, recommendationId: recommendation._id, orderIndex, category: recommendation.category, place: recommendation.place, notes: recommendation.note })
    }
    return pathId
  },
})

export const getPublicBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db.query('askRequests').withIndex('by_slug', (q) => q.eq('slug', args.slug)).unique()
    if (!request) return null
    return { slug: request.slug, prompt: request.prompt, destination: request.destination, journeyTitle: request.journeyTitle, status: request.status }
  },
})

export const submitPublic = internalMutation({
  args: { slug: v.string(), rateLimitKey: v.string(), anonymous: v.boolean(), contributorName: v.optional(v.string()), contributorHandle: v.optional(v.string()), category, place, note: v.string(), referenceURL: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const request = await ctx.db.query('askRequests').withIndex('by_slug', (q) => q.eq('slug', args.slug)).unique()
    if (!request || request.status !== 'open') throw new ConvexError('This request is no longer accepting recommendations.')
    const { ok } = await rateLimiter.limit(ctx, 'publicRecommendation', {
      key: `${request._id}:${args.rateLimitKey}`,
    })
    if (!ok) throw new ConvexError('Please try again later.')
    if (!args.anonymous && !args.contributorName?.trim()) throw new ConvexError('Please add your first name or submit anonymously.')
    if (args.contributorName && args.contributorName.length > 40) throw new ConvexError('Name is too long.')
    if (args.contributorHandle && args.contributorHandle.length > 50) throw new ConvexError('Handle is too long.')
    if (!args.place.name.trim() || args.note.trim().length === 0 || args.note.length > 500) throw new ConvexError('Add a place and a short recommendation.')
    if (args.referenceURL && !isHTTPSURL(args.referenceURL)) throw new ConvexError('Reference links must use HTTPS.')
    if (args.place.latitude < -90 || args.place.latitude > 90 || args.place.longitude < -180 || args.place.longitude > 180) throw new ConvexError('Choose a valid map location.')
    await ctx.db.insert('recommendations', { askRequestId: request._id, anonymous: args.anonymous, contributorName: args.anonymous ? undefined : args.contributorName?.trim(), contributorHandle: args.anonymous ? undefined : args.contributorHandle?.trim(), category: args.category, place: args.place, note: args.note.trim(), referenceURL: args.referenceURL, status: 'pending', submittedAt: Date.now() })
    return null
  },
})

// HTTP actions authenticate first and pass only the session-derived opaque
// Better Auth user ID to these internal helpers. The ID is never accepted from
// a request body, so a mobile caller cannot select another owner's records.
export const createForOwner = internalMutation({
  args: {
    ownerAuthUserId: v.string(), localJourneyID: v.string(), title: v.string(),
    destination: v.string(), prompt: v.string(), startsAt: v.optional(v.number()), endsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.localJourneyID || !args.title.trim() || !args.destination.trim() || !args.prompt.trim()) throw new ConvexError('Add a title, destination, and question.')
    const existingJourney = await ctx.db.query('journeys').withIndex('by_ownerAuthUserId_and_localID', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('localID', args.localJourneyID)).unique()
    const now = Date.now()
    const journeyId = existingJourney?._id ?? await ctx.db.insert('journeys', { ownerAuthUserId: args.ownerAuthUserId, localID: args.localJourneyID, title: args.title, destination: args.destination, startsAt: args.startsAt, endsAt: args.endsAt, updatedAt: now })
    if (existingJourney) await ctx.db.patch(existingJourney._id, { title: args.title, destination: args.destination, startsAt: args.startsAt, endsAt: args.endsAt, updatedAt: now })
    const requestSlug = slug()
    const requestId = await ctx.db.insert('askRequests', { ownerAuthUserId: args.ownerAuthUserId, journeyId, slug: requestSlug, prompt: args.prompt, destination: args.destination, journeyTitle: args.title, status: 'open', createdAt: now })
    return { id: requestId, slug: requestSlug, prompt: args.prompt, destination: args.destination, status: 'open' as const }
  },
})

export const listRecommendationsForOwner = internalQuery({
  args: { ownerAuthUserId: v.string(), requestId: v.id('askRequests') },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request || request.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Request not found.')
    return ctx.db.query('recommendations').withIndex('by_askRequestId_and_submittedAt', (q) => q.eq('askRequestId', request._id)).order('desc').take(100)
  },
})

export const assertRequestOwner = internalQuery({
  args: { ownerAuthUserId: v.string(), requestId: v.id('askRequests') },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request || request.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Request not found.')
    return { journeyId: request.journeyId }
  },
})

export const setRecommendationStatusForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), recommendationId: v.id('recommendations'), status: v.union(v.literal('accepted'), v.literal('ignored')) },
  handler: async (ctx, args) => {
    const recommendation = await ctx.db.get(args.recommendationId)
    if (!recommendation) throw new ConvexError('Recommendation not found.')
    const request = await ctx.db.get(recommendation.askRequestId)
    if (!request || request.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Recommendation not found.')
    await ctx.db.patch(recommendation._id, { status: args.status })
    return null
  },
})

export const listForOwner = internalQuery({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => {
    const requests = await ctx.db.query('askRequests').withIndex('by_ownerAuthUserId_and_createdAt', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId)).order('desc').take(50)
    return Promise.all(requests.map(async (request) => {
      const recommendations = await ctx.db.query('recommendations').withIndex('by_askRequestId_and_submittedAt', (q) => q.eq('askRequestId', request._id)).take(100)
      return { id: request._id, slug: request.slug, prompt: request.prompt, destination: request.destination, status: request.status, createdAt: request.createdAt, recommendationCount: recommendations.length }
    }))
  },
})

export const setRequestStatusForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), requestId: v.id('askRequests'), status: v.union(v.literal('open'), v.literal('closed')) },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request || request.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Request not found.')
    await ctx.db.patch(request._id, { status: args.status, closedAt: args.status === 'closed' ? Date.now() : undefined })
    return null
  },
})
