import { ConvexError, v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation } from './_generated/server'
import { authComponent } from './betterAuth/auth'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import type { DataModel } from './_generated/dataModel'
import { RateLimiter, DAY } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'
import { isCurrentRouteRevision, validatePrivatePathRouteInput } from '../src/lib/pathRoutingValidation'

const waypoint = v.object({ latitude: v.number(), longitude: v.number() })
const routeWaypoint = v.union(v.object({ placeId: v.string() }), waypoint)
const travelMode = v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE'))
const snapshot = v.object({ distanceMeters: v.number(), duration: v.string(), encodedPolyline: v.string(), legs: v.array(v.object({ distanceMeters: v.number(), duration: v.string() })), generatedAt: v.number() })
const googleRoutePlace = v.object({ provider: v.literal('google'), providerPlaceID: v.string() })
const coordinateRoutePlace = v.object({
  provider: v.union(v.literal('apple'), v.literal('manual')),
  latitude: v.number(),
  longitude: v.number(),
})
const privateStop = v.object({
  localStopID: v.string(),
  orderIndex: v.number(),
  place: v.union(googleRoutePlace, coordinateRoutePlace),
})
const routeLimiter = new RateLimiter(components.rateLimiter, {
  ownerPathSync: { kind: 'token bucket', rate: 30, period: DAY, capacity: 10 },
  ownerRouteCalculation: { kind: 'token bucket', rate: 12, period: DAY, capacity: 4 },
})

async function requireOwnerAuthUserId(ctx: GenericCtx<DataModel>) {
  return String((await authComponent.getAuthUser(ctx))._id)
}

export const reserveOwnerRouteCalculation = internalMutation({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => {
    const result = await routeLimiter.limit(ctx, 'ownerRouteCalculation', {
      key: args.ownerAuthUserId,
      throws: false,
    })
    if (!result.ok) throw new ConvexError('You have reached today’s route-calculation limit. Try again later.')
  },
})

/**
 * Syncs only the owner's editable Path and selected place data needed for
 * route calculation. It deliberately excludes source Moment IDs, notes from
 * Moments, photos, audio, and Journey metadata.
 */
export const upsertPrivatePath = mutation({
  args: {
    localPathID: v.string(),
    title: v.string(),
    stops: v.array(privateStop),
  },
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    const syncLimit = await routeLimiter.limit(ctx, 'ownerPathSync', {
      key: ownerAuthUserId,
      throws: false,
    })
    if (!syncLimit.ok) throw new ConvexError('You have reached today’s Path routing limit. Try again later.')
    const validationError = validatePrivatePathRouteInput(args)
    if (validationError) throw new ConvexError(validationError)
    const localPathID = args.localPathID.trim()
    const title = args.title.trim()

    const existing = await ctx.db.query('paths')
      .withIndex('by_ownerAuthUserId_and_localPathID', (q) => q
        .eq('ownerAuthUserId', ownerAuthUserId).eq('localPathID', localPathID))
      .unique()
    const now = Date.now()
    const pathID = existing?._id ?? await ctx.db.insert('paths', {
      ownerAuthUserId, localPathID, title, status: 'draft', createdAt: now, updatedAt: now, routeRevision: 0,
    })
    const previousStops = await ctx.db.query('privateRouteStops')
      .withIndex('by_pathId_and_orderIndex', (q) => q.eq('pathId', pathID))
      .take(26)
    const nextStops = [...args.stops].sort((left, right) => left.orderIndex - right.orderIndex)
    const previousSorted = [...previousStops].sort((left, right) => left.orderIndex - right.orderIndex)
    const unchanged = existing?.title === title && previousSorted.length === nextStops.length &&
      previousSorted.every((previous, index) => {
        const next = nextStops[index]!
        return previous.localStopID === next.localStopID && previous.orderIndex === next.orderIndex &&
          previous.provider === next.place.provider &&
          previous.providerPlaceID === ('providerPlaceID' in next.place ? next.place.providerPlaceID : undefined) &&
          previous.latitude === ('latitude' in next.place ? next.place.latitude : undefined) &&
          previous.longitude === ('longitude' in next.place ? next.place.longitude : undefined)
      })

    if (!unchanged) {
      await ctx.db.patch(pathID, {
        title,
        updatedAt: now,
        routeRevision: (existing?.routeRevision ?? 0) + 1,
      })
      for (const stop of previousStops) await ctx.db.delete(stop._id)
      for (const stop of nextStops) {
        await ctx.db.insert('privateRouteStops', {
          pathId: pathID,
          ownerAuthUserId,
          localStopID: stop.localStopID,
          orderIndex: stop.orderIndex,
          ...stop.place,
        })
      }

      const staleSnapshots = await ctx.db.query('routeSnapshots')
        .withIndex('by_ownerAuthUserId_and_pathId_and_travelMode', (q) => q
          .eq('ownerAuthUserId', ownerAuthUserId).eq('pathId', pathID))
        .take(8)
      for (const route of staleSnapshots) await ctx.db.delete(route._id)
    }
    return { pathID }
  },
})

/**
 * Route coordinates are loaded from the owner's stored Path. An HTTP caller
 * may choose a travel mode, but never arbitrary coordinates that could turn
 * a paid Routes call into an open proxy.
 */
export const storedStopsForOwner = internalQuery({
  args: { ownerAuthUserId: v.string(), pathId: v.id('paths') },
  handler: async (ctx, args) => {
    const path = await ctx.db.get(args.pathId)
    if (!path || path.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Path not found.')
    const privateStops = await ctx.db.query('privateRouteStops')
      .withIndex('by_pathId_and_orderIndex', (q) => q.eq('pathId', path._id)).order('asc').take(26)
    const stops = privateStops.length > 0
      ? privateStops.map((stop) => stop.provider === 'google'
        ? { placeId: stop.providerPlaceID! }
        : { latitude: stop.latitude!, longitude: stop.longitude! })
      : await (async () => {
        // Existing Ask-generated Paths still use the contribution model.
        // Prefer the durable Place ID over cached Google place details.
        const contributionStops = await ctx.db.query('pathStops')
          .withIndex('by_pathId_and_orderIndex', (q) => q.eq('pathId', path._id)).order('asc').take(26)
        return contributionStops.map((stop) => stop.place.provider === 'google' && stop.place.providerPlaceID
          ? { placeId: stop.place.providerPlaceID }
          : { latitude: stop.place.latitude, longitude: stop.place.longitude })
      })()
    return { routeRevision: path.routeRevision ?? 0, stops }
  },
})

export const deleteLegacyTransitSnapshots = internalMutation({
  args: { ownerAuthUserId: v.string(), pathId: v.id('paths') },
  handler: async (ctx, args) => {
    const path = await ctx.db.get(args.pathId)
    if (!path || path.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Path not found.')
    const snapshots = await ctx.db.query('routeSnapshots')
      .withIndex('by_ownerAuthUserId_and_pathId_and_travelMode', (q) => q
        .eq('ownerAuthUserId', args.ownerAuthUserId).eq('pathId', args.pathId))
      .take(8)
    for (const snapshot of snapshots) {
      if (snapshot.travelMode === 'TRANSIT') await ctx.db.delete(snapshot._id)
    }
  },
})

export const saveSnapshotForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), pathId: v.id('paths'), routeRevision: v.number(), travelMode, snapshot },
  handler: async (ctx, args) => {
    const path = await ctx.db.get(args.pathId)
    if (!path || path.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Path not found.')
    if (!isCurrentRouteRevision(path.routeRevision ?? 0, args.routeRevision)) {
      throw new ConvexError('Path changed while routing. Calculate the updated Path again.')
    }
    const existing = await ctx.db.query('routeSnapshots').withIndex('by_ownerAuthUserId_and_pathId_and_travelMode', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('pathId', args.pathId).eq('travelMode', args.travelMode)).unique()
    const value = { ...args.snapshot, ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId, routeRevision: args.routeRevision, travelMode: args.travelMode, expiresAt: args.snapshot.generatedAt + 5 * 60 * 1_000 }
    if (existing) { await ctx.db.replace(existing._id, value); return existing._id }
    return ctx.db.insert('routeSnapshots', value)
  },
})

export const latestSnapshotForOwner = internalQuery({
  args: { ownerAuthUserId: v.string(), pathId: v.id('paths'), travelMode },
  handler: async (ctx, args) => {
    const path = await ctx.db.get(args.pathId)
    if (!path || path.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Path not found.')
    const result = await ctx.db.query('routeSnapshots').withIndex('by_ownerAuthUserId_and_pathId_and_travelMode', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('pathId', args.pathId).eq('travelMode', args.travelMode)).unique()
    return result && result.expiresAt > Date.now() && result.routeRevision !== undefined &&
      isCurrentRouteRevision(path.routeRevision ?? 0, result.routeRevision) && result.travelMode !== 'TRANSIT' ? {
      distanceMeters: result.distanceMeters,
      duration: result.duration,
      encodedPolyline: result.encodedPolyline,
      legs: result.legs,
      generatedAt: result.generatedAt,
    } : null
  },
})


/**
 * Server-only Google Routes adapter. Consumers treat the return value as a
 * short-lived snapshot and re-request it after order/mode changes.
 */
export const compute = internalAction({
  args: {
    stops: v.array(routeWaypoint),
    travelMode: v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE')),
  },
  handler: async (_ctx, args) => {
    if (args.stops.length < 2) throw new ConvexError('Choose at least two stops to calculate a route.')
    if (args.stops.length > 25) throw new ConvexError('A Path can route up to 25 stops at once.')
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY
    if (!apiKey) throw new ConvexError('Routing is not configured.')
    const toWaypoint = (point: { placeId: string } | { latitude: number; longitude: number }) =>
      'placeId' in point ? { placeId: point.placeId } : { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } }
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration',
      },
      body: JSON.stringify({
        origin: toWaypoint(args.stops[0]),
        destination: toWaypoint(args.stops[args.stops.length - 1]),
        intermediates: args.stops.slice(1, -1).map(toWaypoint),
        travelMode: args.travelMode,
        computeAlternativeRoutes: false,
        polylineQuality: 'OVERVIEW',
      }),
    })
    if (!response.ok) throw new ConvexError('Routing is temporarily unavailable.')
    const body = await response.json() as { routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string }; legs?: Array<{ distanceMeters?: number; duration?: string }> }> }
    const route = body.routes?.[0]
    if (route?.distanceMeters === undefined || !route.duration || !route.polyline?.encodedPolyline) throw new ConvexError('Routing returned an incomplete route.')
    return {
      distanceMeters: route.distanceMeters,
      duration: route.duration,
      encodedPolyline: route.polyline.encodedPolyline,
      legs: (route.legs ?? []).map((leg) => ({ distanceMeters: leg.distanceMeters ?? 0, duration: leg.duration ?? '0s' })),
      generatedAt: Date.now(),
    }
  },
})
