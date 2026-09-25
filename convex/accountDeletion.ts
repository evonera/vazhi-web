import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'

// Dependents precede their parents so ownership remains verifiable throughout
// the purge. Each scheduled mutation paginates one bounded table page.
const phases = [
  'moderationActions', 'reports', 'itineraryVersions',
  'recommendations', 'pathStops', 'privateRouteStops', 'routeSnapshots',
  'askRequests', 'paths', 'publicItineraryListings', 'journeys',
  'syncedMoments', 'syncedJourneys', 'syncedOutboxJobs', 'aiUsageEvents',
  'profileHandleAliases', 'profiles',
] as const

type Phase = typeof phases[number]
type OwnedRow = {
  ownerAuthUserId?: string
  listingId?: Id<'publicItineraryListings'>
  reportId?: Id<'reports'>
  listingSlug?: string
  askRequestId?: Id<'askRequests'>
  pathId?: Id<'paths'>
}

async function belongsToAccount(ctx: MutationCtx, phase: Phase, row: OwnedRow, ownerAuthUserId: string) {
  if (row.ownerAuthUserId !== undefined) return row.ownerAuthUserId === ownerAuthUserId
  if (phase === 'recommendations' && row.askRequestId) {
    const request = await ctx.db.get(row.askRequestId)
    return request?.ownerAuthUserId === ownerAuthUserId
  }
  if (phase === 'pathStops' && row.pathId) {
    const path = await ctx.db.get(row.pathId)
    return path?.ownerAuthUserId === ownerAuthUserId
  }
  if (phase === 'itineraryVersions' && row.listingId) {
    const listing = await ctx.db.get(row.listingId)
    return listing?.ownerAuthUserId === ownerAuthUserId
  }
  if (phase === 'moderationActions' && row.reportId) {
    const report = await ctx.db.get(row.reportId)
    if (report?.listingId) {
      const listing = await ctx.db.get(report.listingId)
      return listing?.ownerAuthUserId === ownerAuthUserId
    }
    if (report?.listingSlug) {
      const listing = await ctx.db.query('publicItineraryListings')
        .withIndex('by_slug', (q) => q.eq('slug', report.listingSlug)).first()
      return listing?.ownerAuthUserId === ownerAuthUserId
    }
    if (row.listingId) {
      const listing = await ctx.db.get(row.listingId)
      return listing?.ownerAuthUserId === ownerAuthUserId
    }
  }
  if (phase === 'reports') {
    const listing = row.listingId
      ? await ctx.db.get(row.listingId)
      : row.listingSlug
        ? await ctx.db.query('publicItineraryListings').withIndex('by_slug', (q) => q.eq('slug', row.listingSlug!)).first()
        : null
    return listing?.ownerAuthUserId === ownerAuthUserId
  }
  return false
}

export const prepare = internalMutation({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, { ownerAuthUserId }) => {
    const existing = await ctx.db.query('accountDeletionJobs')
      .withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', ownerAuthUserId)).first()
    if (existing) return
    const jobId = await ctx.db.insert('accountDeletionJobs', {
      ownerAuthUserId, state: 'pending', phase: 0, createdAt: Date.now(),
    })
    // If auth deletion succeeds but the afterDelete callback is interrupted,
    // recover by checking whether Better Auth's user record still exists.
    await ctx.scheduler.runAfter(60_000, internal.accountDeletion.recover, { jobId })
  },
})

export const activate = internalMutation({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, { ownerAuthUserId }) => {
    const job = await ctx.db.query('accountDeletionJobs')
      .withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', ownerAuthUserId)).first()
    if (!job) throw new Error('Account deletion job is missing.')
    if (job.state === 'pending') await ctx.db.patch(job._id, { state: 'active' })
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purgeNext, { jobId: job._id })
  },
})

export const recover = internalMutation({
  args: { jobId: v.id('accountDeletionJobs') },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId)
    if (!job || job.state !== 'pending') return
    const user = await ctx.db.get(job.ownerAuthUserId as Id<'user'>)
    if (user) return // Better Auth rejected or did not finish deletion.
    await ctx.db.patch(jobId, { state: 'active' })
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purgeNext, { jobId })
  },
})

export const purgeNext = internalMutation({
  args: { jobId: v.id('accountDeletionJobs') },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId)
    if (!job || job.state !== 'active') return
    const phase = phases[job.phase]
    if (!phase) {
      await ctx.db.delete(jobId)
      return
    }
    const page = await ctx.db.query(phase).paginate({ numItems: 50, cursor: job.cursor ?? null })
    for (const row of page.page) {
      if (await belongsToAccount(ctx, phase, row as OwnedRow, job.ownerAuthUserId)) {
        await ctx.db.delete(row._id)
      }
    }
    await ctx.db.patch(jobId, page.isDone
      ? { phase: job.phase + 1, cursor: undefined }
      : { cursor: page.continueCursor })
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purgeNext, { jobId })
  },
})
