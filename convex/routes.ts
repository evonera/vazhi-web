import { ConvexError, v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'

const waypoint = v.object({ latitude: v.number(), longitude: v.number() })
const travelMode = v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE'), v.literal('TRANSIT'))
const snapshot = v.object({ distanceMeters: v.number(), duration: v.string(), encodedPolyline: v.string(), legs: v.array(v.object({ distanceMeters: v.number(), duration: v.string() })), generatedAt: v.number() })

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
    const stops = await ctx.db.query('pathStops').withIndex('by_pathId_and_orderIndex', (q) => q.eq('pathId', path._id)).order('asc').take(26)
    return stops.map((stop) => ({ latitude: stop.place.latitude, longitude: stop.place.longitude }))
  },
})

export const saveSnapshotForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), pathId: v.id('paths'), travelMode, snapshot },
  handler: async (ctx, args) => {
    const path = await ctx.db.get(args.pathId)
    if (!path || path.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Path not found.')
    const existing = await ctx.db.query('routeSnapshots').withIndex('by_ownerAuthUserId_and_pathId_and_travelMode', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('pathId', args.pathId).eq('travelMode', args.travelMode)).unique()
    const value = { ...args.snapshot, ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId, travelMode: args.travelMode, expiresAt: args.snapshot.generatedAt + 5 * 60 * 1_000 }
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
    return result && result.expiresAt > Date.now() ? result : null
  },
})

/**
 * Server-only Google Routes adapter. Consumers treat the return value as a
 * short-lived snapshot and re-request it after order/mode changes.
 */
export const compute = internalAction({
  args: {
    stops: v.array(waypoint),
    travelMode: v.union(v.literal('DRIVE'), v.literal('WALK'), v.literal('BICYCLE'), v.literal('TRANSIT')),
  },
  handler: async (_ctx, args) => {
    if (args.stops.length < 2) throw new ConvexError('Choose at least two stops to calculate a route.')
    if (args.stops.length > 25) throw new ConvexError('A Path can route up to 25 stops at once.')
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY
    if (!apiKey) throw new ConvexError('Routing is not configured.')
    const toWaypoint = (point: { latitude: number; longitude: number }) => ({ location: { latLng: { latitude: point.latitude, longitude: point.longitude } } })
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
    if (!route?.polyline?.encodedPolyline || route.distanceMeters === undefined || !route.duration) throw new ConvexError('Routing returned an incomplete route.')
    return {
      distanceMeters: route.distanceMeters,
      duration: route.duration,
      encodedPolyline: route.polyline.encodedPolyline,
      legs: (route.legs ?? []).map((leg) => ({ distanceMeters: leg.distanceMeters ?? 0, duration: leg.duration ?? '0s' })),
      generatedAt: Date.now(),
    }
  },
})
