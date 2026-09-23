import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import { internal, components } from './_generated/api'
import { Workpool, vOnCompleteArgs } from '@convex-dev/workpool'
import { RateLimiter, HOUR } from '@convex-dev/rate-limiter'

const routeRefreshLimiter = new RateLimiter(components.rateLimiter, {
  routeRefresh: { kind: 'token bucket', rate: 5, period: HOUR, capacity: 5 },
})
const MAX_QUEUED_ROUTES_PER_OWNER = 5
const MAX_QUEUED_ROUTES_GLOBAL = 100

const waypoint = v.object({ latitude: v.number(), longitude: v.number() })
const travelMode = v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE'), v.literal('TRANSIT'))

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
    stops: v.array(waypoint),
    travelMode,
  },
  handler: async (ctx, args) => {
    // Google Routes is called only for its short-lived derived snapshot. Do
    // not return the polyline to Workpool's status store; it may contain a
    // private route. A future approved-public route can persist its own safe
    // projection from this action.
    await ctx.runAction(internal.routes.compute, args)
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
    stops: v.array(waypoint),
    travelMode,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('backgroundJobs')
      .withIndex('by_ownerAuthUserId_and_idempotencyKey', (q) => q
        .eq('ownerAuthUserId', args.ownerAuthUserId)
        .eq('idempotencyKey', args.idempotencyKey))
      .unique()
    if (existing) return { id: existing._id, state: existing.state }

    const allowance = await routeRefreshLimiter.limit(ctx, 'routeRefresh', {
      key: args.ownerAuthUserId,
      throws: false,
    })
    if (!allowance.ok) return { kind: 'rate_limited' as const }

    // Bound both per-owner and global backlog. These indexed reads stop one
    // account or a burst of accounts from turning a two-worker pool into an
    // unbounded Google Routes bill. Mutation serializability makes admission
    // and insertion atomic with respect to competing requests.
    const [ownerQueued, allQueued] = await Promise.all([
      ctx.db.query('backgroundJobs')
        .withIndex('by_ownerAuthUserId_and_state', (q) => q
          .eq('ownerAuthUserId', args.ownerAuthUserId)
          .eq('state', 'queued'))
        .take(MAX_QUEUED_ROUTES_PER_OWNER),
      ctx.db.query('backgroundJobs')
        .withIndex('by_state', (q) => q.eq('state', 'queued'))
        .take(MAX_QUEUED_ROUTES_GLOBAL),
    ])
    if (ownerQueued.length >= MAX_QUEUED_ROUTES_PER_OWNER || allQueued.length >= MAX_QUEUED_ROUTES_GLOBAL) {
      return { kind: 'queue_full' as const }
    }

    const jobId = await ctx.db.insert('backgroundJobs', {
      ownerAuthUserId: args.ownerAuthUserId,
      idempotencyKey: args.idempotencyKey,
      kind: 'route_snapshot_refresh',
      state: 'queued',
      createdAt: Date.now(),
    })
    await backgroundWorkpool.enqueueAction(ctx, internal.background.refreshRouteSnapshot, {
      stops: args.stops,
      travelMode: args.travelMode,
    }, {
      retry: true,
      onComplete: internal.background.markRouteSnapshotFinished,
      context: { jobId },
    })
    return { kind: 'queued' as const, id: jobId, state: 'queued' as const }
  },
})
