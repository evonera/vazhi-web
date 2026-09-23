import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import { internal, components } from './_generated/api'
import { Workpool, vOnCompleteArgs } from '@convex-dev/workpool'

const travelMode = v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE'))

// This pool deliberately has no interactive traffic. It only refreshes route
// snapshots after a user leaves the editing flow, so typeahead and Path
// creation cannot be delayed by retries or provider outages.
const backgroundWorkpool = new Workpool(components.backgroundWorkpool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
})

export const refreshRouteSnapshot = internalAction({
  args: {
    ownerAuthUserId: v.string(),
    pathId: v.id('paths'),
    travelMode,
  },
  handler: async (ctx, args) => {
    // Google Routes is called only for its short-lived derived snapshot. Do
    // not return the polyline to Workpool's status store; it may contain a
    // private route. A future approved-public route can persist its own safe
    // projection from this action.
    await ctx.runMutation(internal.routes.deleteLegacyTransitSnapshots, { ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId })
    const stored = await ctx.runQuery(internal.routes.storedStopsForOwner, { ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId })
    const route = await ctx.runAction(internal.routes.compute, { stops: stored.stops, travelMode: args.travelMode })
    await ctx.runMutation(internal.routes.saveSnapshotForOwner, { ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId, routeRevision: stored.routeRevision, travelMode: args.travelMode, snapshot: route })
    return null
  },
})

export const markRouteSnapshotFinished = internalMutation({
  args: vOnCompleteArgs(v.object({ jobId: v.id('backgroundJobs') })),
  handler: async (ctx, { context, result }) => {
    const job = await ctx.db.get(context.jobId)
    if (!job) return
    await ctx.db.patch(job._id, {
      state: result.kind === 'success' ? 'completed' : 'failed',
      completedAt: Date.now(),
    })
  },
})

/**
 * Called only after owner authorization by a server endpoint or future native
 * repository. Repeating the same key returns the existing receipt instead of
 * enqueuing another Google call, which makes retries safe.
 */
export const enqueueRouteSnapshotRefresh = internalMutation({
  args: {
    ownerAuthUserId: v.string(),
    idempotencyKey: v.string(),
    pathId: v.id('paths'),
    travelMode,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('backgroundJobs')
      .withIndex('by_ownerAuthUserId_and_idempotencyKey', (q) => q
        .eq('ownerAuthUserId', args.ownerAuthUserId)
        .eq('idempotencyKey', args.idempotencyKey))
      .unique()
    if (existing) return { id: existing._id, state: existing.state }

    const jobId = await ctx.db.insert('backgroundJobs', {
      ownerAuthUserId: args.ownerAuthUserId,
      idempotencyKey: args.idempotencyKey,
      kind: 'route_snapshot_refresh',
      state: 'queued',
      createdAt: Date.now(),
    })
    await backgroundWorkpool.enqueueAction(ctx, internal.background.refreshRouteSnapshot, {
      ownerAuthUserId: args.ownerAuthUserId,
      pathId: args.pathId,
      travelMode: args.travelMode,
    }, {
      retry: true,
      onComplete: internal.background.markRouteSnapshotFinished,
      context: { jobId },
    })
    return { id: jobId, state: 'queued' as const }
  },
})
