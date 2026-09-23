import { action } from './_generated/server'
import { v } from 'convex/values'
import { authComponent } from './betterAuth/auth'
import { internal } from './_generated/api'
import type { RegisteredAction } from 'convex/server'
import type { Id } from './_generated/dataModel'

const travelMode = v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE'))
type TravelMode = 'DRIVE' | 'WALK' | 'BICYCLE'
type RouteResult = {
  distanceMeters: number
  duration: string
  encodedPolyline: string
  legs: Array<{ distanceMeters: number; duration: string }>
  generatedAt: number
}

/** Authenticated native action. Route geometry is derived only from the
 * owner's synced Path, never from arbitrary caller-supplied coordinates. */
export const forCurrentOwner: RegisteredAction<'public', { pathID: Id<'paths'>; travelMode: TravelMode }, Promise<RouteResult>> = action({
  args: { pathID: v.id('paths'), travelMode },
  handler: async (ctx, args): Promise<RouteResult> => {
    const ownerAuthUserId = String((await authComponent.getAuthUser(ctx))._id)
    const cached: RouteResult | null = await ctx.runQuery(internal.routes.latestSnapshotForOwner, {
      ownerAuthUserId, pathId: args.pathID, travelMode: args.travelMode,
    })
    if (cached) return cached

    const stops: Array<{ placeId: string } | { latitude: number; longitude: number }> = await ctx.runQuery(internal.routes.storedStopsForOwner, {
      ownerAuthUserId, pathId: args.pathID,
    })
    await ctx.runMutation(internal.routes.reserveOwnerRouteCalculation, { ownerAuthUserId })
    const result: RouteResult = await ctx.runAction(internal.routes.compute, { stops, travelMode: args.travelMode })
    await ctx.runMutation(internal.routes.saveSnapshotForOwner, {
      ownerAuthUserId, pathId: args.pathID, travelMode: args.travelMode, snapshot: result,
    })
    return result
  },
})
