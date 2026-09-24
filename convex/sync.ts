import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { authComponent } from './betterAuth/auth'
import { getOutboxJobValidationError, isSnapshotNewer } from './syncValidation'

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

      const validationError = getOutboxJobValidationError(item)
      if (validationError) {
        // Invalid jobs are reported without writing their Journey. Any
        // unexpected database failure below is allowed to escape so Convex
        // rolls back the whole mutation transaction instead of committing a
        // partial Journey update.
        failedJobIds.push(item.jobId)
        continue
      }

      const journeySnapshot = item.journey!
      const currentJourney = await ctx.db.query('syncedJourneys')
        .withIndex('by_ownerAuthUserId_and_localJourneyId', (q) => q
          .eq('ownerAuthUserId', ownerAuthUserId).eq('localJourneyId', journeySnapshot.id))
        .unique()
      const shouldApplyJourney = !currentJourney || isSnapshotNewer(
        journeySnapshot.updatedAt,
        item.createdAt,
        currentJourney.updatedAt,
        currentJourney.lastSyncJobCreatedAt,
      )
      if (shouldApplyJourney) {
        const journeyRecord = {
          ownerAuthUserId, localJourneyId: journeySnapshot.id, title: journeySnapshot.title,
          summaryText: journeySnapshot.summaryText, createdAt: journeySnapshot.createdAt,
          updatedAt: journeySnapshot.updatedAt, lastSyncJobCreatedAt: item.createdAt,
        }
        if (currentJourney) await ctx.db.patch(currentJourney._id, journeyRecord)
        else await ctx.db.insert('syncedJourneys', journeyRecord)
      }

      if (item.actionType === 'createMoment') {
        const validMoment = item.moment!
        const currentMoment = await ctx.db.query('syncedMoments')
          .withIndex('by_ownerAuthUserId_and_localMomentId', (q) => q
            .eq('ownerAuthUserId', ownerAuthUserId).eq('localMomentId', validMoment.id))
          .unique()
        const shouldApplyMoment = !currentMoment || isSnapshotNewer(
          journeySnapshot.updatedAt,
          item.createdAt,
          currentMoment.sourceUpdatedAt,
          currentMoment.lastSyncJobCreatedAt,
        )
        if (shouldApplyMoment) {
          const momentRecord = {
            ownerAuthUserId, localMomentId: validMoment.id, localJourneyId: validMoment.journeyId,
            capturedAt: validMoment.capturedAt, note: validMoment.note, syncState: validMoment.syncState,
            latitude: validMoment.latitude, longitude: validMoment.longitude, placeName: validMoment.placeName,
            locality: validMoment.locality, country: validMoment.country, placeSource: validMoment.placeSource,
            placeProviderID: validMoment.placeProviderID, formattedAddress: validMoment.formattedAddress,
            placePrimaryType: validMoment.placePrimaryType, assetKinds: validMoment.assetKinds,
            updatedAt: Date.now(), sourceUpdatedAt: journeySnapshot.updatedAt, lastSyncJobCreatedAt: item.createdAt,
          }
          if (currentMoment) await ctx.db.patch(currentMoment._id, momentRecord)
          else await ctx.db.insert('syncedMoments', momentRecord)
        }
      }

      await ctx.db.insert('syncedOutboxJobs', {
        ownerAuthUserId, jobId: item.jobId, actionType: item.actionType, completedAt: Date.now(),
      })
      syncedJobIds.push(item.jobId)
    }
    return { syncedJobIds, failedJobIds, serverTimestamp: Date.now() }
  },
})
