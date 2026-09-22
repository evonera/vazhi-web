import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

/**
 * Claims pre-Better-Auth Ask-the-Way data for the same signed-in subject.
 *
 * The old records store the custom JWT token identifier. The caller supplies
 * it only after reading the current verified Convex identity in `http.ts`; it
 * is never accepted from an app/browser request body. The operation is safe to
 * repeat: it removes the legacy field as it backfills every document, and
 * recomputes denormalised counts from recommendation records instead of
 * trusting missing/stale legacy counters.
 */
export const claimLegacyAskData = internalMutation({
  args: { ownerAuthUserId: v.string(), legacyTokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const journeys = await ctx.db.query('journeys')
      .withIndex('by_ownerTokenIdentifier_and_localID', (q) => q
        .eq('ownerTokenIdentifier', args.legacyTokenIdentifier))
      .take(500)
    const requests = await ctx.db.query('askRequests')
      .withIndex('by_ownerTokenIdentifier_and_createdAt', (q) => q
        .eq('ownerTokenIdentifier', args.legacyTokenIdentifier))
      .take(500)

    const requestCounts = new Map<string, { recommendations: number; pending: number }>()
    for (const request of requests) {
      const recommendations = await ctx.db.query('recommendations')
        .withIndex('by_askRequestId_and_submittedAt', (q) => q.eq('askRequestId', request._id))
        .collect()
      requestCounts.set(String(request._id), {
        recommendations: recommendations.length,
        pending: recommendations.filter((item) => item.status === 'pending').length,
      })
    }

    for (const journey of journeys) {
      const journeyRequests = await ctx.db.query('askRequests')
        .withIndex('by_journeyId_and_createdAt', (q) => q.eq('journeyId', journey._id))
        .collect()
      const ownedRequests = journeyRequests.filter((request) =>
        request.ownerTokenIdentifier === args.legacyTokenIdentifier || request.ownerAuthUserId === args.ownerAuthUserId)
      const counts = ownedRequests.reduce((total, request) => {
        const requestCount = requestCounts.get(String(request._id))
        total.recommendations += requestCount?.recommendations ?? request.recommendationCount ?? 0
        total.pending += requestCount?.pending ?? request.pendingRecommendationCount ?? 0
        return total
      }, { recommendations: 0, pending: 0 })
      await ctx.db.patch(journey._id, {
        ownerAuthUserId: args.ownerAuthUserId,
        ownerTokenIdentifier: undefined,
        askRequestCount: ownedRequests.length,
        openAskRequestCount: ownedRequests.filter((request) => request.status === 'open').length,
        recommendationCount: counts.recommendations,
        pendingRecommendationCount: counts.pending,
      })

      const paths = await ctx.db.query('paths')
        .withIndex('by_journeyId_and_createdAt', (q) => q.eq('journeyId', journey._id))
        .collect()
      for (const path of paths) {
        if (path.ownerTokenIdentifier === args.legacyTokenIdentifier || path.ownerAuthUserId === args.ownerAuthUserId) {
          await ctx.db.patch(path._id, { ownerAuthUserId: args.ownerAuthUserId, ownerTokenIdentifier: undefined })
        }
      }
    }

    for (const request of requests) {
      const journey = await ctx.db.get(request.journeyId)
      const counts = requestCounts.get(String(request._id))
      await ctx.db.patch(request._id, {
        ownerAuthUserId: args.ownerAuthUserId,
        ownerTokenIdentifier: undefined,
        localJourneyID: request.localJourneyID ?? journey?.localID,
        recommendationCount: counts?.recommendations ?? request.recommendationCount ?? 0,
        pendingRecommendationCount: counts?.pending ?? request.pendingRecommendationCount ?? 0,
      })
    }
    return { journeys: journeys.length, requests: requests.length }
  },
})
