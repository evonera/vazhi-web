import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { authComponent } from './betterAuth/auth'

const journey = v.object({
  id: v.string(), title: v.string(), summaryText: v.string(),
  createdAt: v.string(), updatedAt: v.string(),
})

const moment = v.object({
  id: v.string(), journeyId: v.string(), capturedAt: v.string(), note: v.string(), syncState: v.string(),
  latitude: v.optional(v.number()), longitude: v.optional(v.number()), placeName: v.optional(v.string()),
  locality: v.optional(v.string()), country: v.optional(v.string()), placeSource: v.optional(v.string()),
  placeProviderID: v.optional(v.string()), formattedAddress: v.optional(v.string()),
  placePrimaryType: v.optional(v.string()), assetKinds: v.array(v.string()),
})

const outboxJob = v.object({
  jobId: v.string(),
  actionType: v.union(v.literal('upsertJourney'), v.literal('createMoment')),
  createdAt: v.string(), journeyId: v.optional(v.string()), journey: v.optional(journey),
  moment: v.optional(moment), rawPayloadJSON: v.string(),
})

/**
 * Idempotent private-journal ingress for the iOS SwiftData outbox. Ownership
 * is derived solely from Better Auth, and a repeated job ID has the same
 * successful outcome without duplicating a Journey or Moment.
 */
export const pushOutboxBatch = mutation({
  args: { jobs: v.array(outboxJob) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx)
    const ownerAuthUserId = String(user._id)
    const syncedJobIds: string[] = []
    const failedJobIds: string[] = []

    for (const item of args.jobs) {
      const completed = await ctx.db.query('syncedOutboxJobs')
        .withIndex('by_ownerAuthUserId_and_jobId', (q) => q
          .eq('ownerAuthUserId', ownerAuthUserId).eq('jobId', item.jobId))
        .unique()
      if (completed) { syncedJobIds.push(item.jobId); continue }

      try {
        if (!item.journey) throw new ConvexError('A Journey snapshot is required for sync.')
        const currentJourney = await ctx.db.query('syncedJourneys')
          .withIndex('by_ownerAuthUserId_and_localJourneyId', (q) => q
            .eq('ownerAuthUserId', ownerAuthUserId).eq('localJourneyId', item.journey!.id))
          .unique()
        const journeyRecord = {
          ownerAuthUserId, localJourneyId: item.journey.id, title: item.journey.title,
          summaryText: item.journey.summaryText, createdAt: item.journey.createdAt,
          updatedAt: item.journey.updatedAt,
        }
        if (currentJourney) await ctx.db.patch(currentJourney._id, journeyRecord)
        else await ctx.db.insert('syncedJourneys', journeyRecord)

        if (item.actionType === 'createMoment') {
          if (!item.moment || item.moment.journeyId !== item.journey.id) {
            throw new ConvexError('Moment must belong to its synced Journey.')
          }
          const currentMoment = await ctx.db.query('syncedMoments')
            .withIndex('by_ownerAuthUserId_and_localMomentId', (q) => q
              .eq('ownerAuthUserId', ownerAuthUserId).eq('localMomentId', item.moment!.id))
            .unique()
          const momentRecord = {
            ownerAuthUserId, localMomentId: item.moment.id, localJourneyId: item.moment.journeyId,
            capturedAt: item.moment.capturedAt, note: item.moment.note, syncState: item.moment.syncState,
            latitude: item.moment.latitude, longitude: item.moment.longitude, placeName: item.moment.placeName,
            locality: item.moment.locality, country: item.moment.country, placeSource: item.moment.placeSource,
            placeProviderID: item.moment.placeProviderID, formattedAddress: item.moment.formattedAddress,
            placePrimaryType: item.moment.placePrimaryType, assetKinds: item.moment.assetKinds, updatedAt: Date.now(),
          }
          if (currentMoment) await ctx.db.patch(currentMoment._id, momentRecord)
          else await ctx.db.insert('syncedMoments', momentRecord)
        }

        await ctx.db.insert('syncedOutboxJobs', {
          ownerAuthUserId, jobId: item.jobId, actionType: item.actionType, completedAt: Date.now(),
        })
        syncedJobIds.push(item.jobId)
      } catch {
        // Keep a malformed or rejected record in the local retry flow while
        // allowing the rest of the batch to make durable progress.
        failedJobIds.push(item.jobId)
      }
    }
    return { syncedJobIds, failedJobIds, serverTimestamp: Date.now() }
  },
})
