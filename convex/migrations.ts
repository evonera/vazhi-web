import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

const BATCH_SIZE = 25

/**
 * Claims pre-Better-Auth Ask-the-Way data for the same signed-in subject.
 *
 * The old records store the custom JWT token identifier. The caller supplies
 * it only after reading the current verified Convex identity in `http.ts`; it
 * is never accepted from an app/browser request body. Each invocation claims
 * a fixed-size slice, removes the legacy field, and reports whether more rows
 * remain. Repeated owner requests advance the migration without a large,
 * unbounded transaction or collection scan.
 */
export const claimLegacyAskData = internalMutation({
  args: { ownerAuthUserId: v.string(), legacyTokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const journeyBatch = await ctx.db.query('journeys')
      .withIndex('by_ownerTokenIdentifier_and_localID', (q) => q
        .eq('ownerTokenIdentifier', args.legacyTokenIdentifier))
      .take(BATCH_SIZE + 1)
    const requestBatch = await ctx.db.query('askRequests')
      .withIndex('by_ownerTokenIdentifier_and_createdAt', (q) => q
        .eq('ownerTokenIdentifier', args.legacyTokenIdentifier))
      .take(BATCH_SIZE + 1)
    const pathBatch = await ctx.db.query('paths')
      .withIndex('by_ownerTokenIdentifier_and_createdAt', (q) => q
        .eq('ownerTokenIdentifier', args.legacyTokenIdentifier))
      .take(BATCH_SIZE + 1)

    // Each pass reads and writes at most 25 documents per table. Claimed rows
    // leave the legacy indexes, so a later authenticated request advances to
    // the next bounded slice instead of rescanning the same records.
    for (const journey of journeyBatch.slice(0, BATCH_SIZE)) {
      await ctx.db.patch(journey._id, {
        ownerAuthUserId: args.ownerAuthUserId,
        ownerTokenIdentifier: undefined,
        askRequestCount: journey.askRequestCount ?? 0,
        openAskRequestCount: journey.openAskRequestCount ?? 0,
        recommendationCount: journey.recommendationCount ?? 0,
        pendingRecommendationCount: journey.pendingRecommendationCount ?? 0,
      })
    }

    for (const request of requestBatch.slice(0, BATCH_SIZE)) {
      const journey = await ctx.db.get(request.journeyId)
      await ctx.db.patch(request._id, {
        ownerAuthUserId: args.ownerAuthUserId,
        ownerTokenIdentifier: undefined,
        localJourneyID: request.localJourneyID ?? journey?.localID,
        recommendationCount: request.recommendationCount ?? 0,
        pendingRecommendationCount: request.pendingRecommendationCount ?? 0,
      })
    }

    for (const path of pathBatch.slice(0, BATCH_SIZE)) {
      await ctx.db.patch(path._id, {
        ownerAuthUserId: args.ownerAuthUserId,
        ownerTokenIdentifier: undefined,
      })
    }

    return {
      journeys: Math.min(journeyBatch.length, BATCH_SIZE),
      requests: Math.min(requestBatch.length, BATCH_SIZE),
      paths: Math.min(pathBatch.length, BATCH_SIZE),
      hasMore: journeyBatch.length > BATCH_SIZE || requestBatch.length > BATCH_SIZE || pathBatch.length > BATCH_SIZE,
    }
  },
})
