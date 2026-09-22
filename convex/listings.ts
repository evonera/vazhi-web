import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { RateLimiter, HOUR } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'

const visibility = v.union(v.literal('public'), v.literal('unlisted'))
const stop = v.object({
  orderIndex: v.number(),
  title: v.string(),
  notes: v.string(),
  placeName: v.optional(v.string()),
  locality: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  isApproximateLocation: v.boolean(),
})

const reportLimiter = new RateLimiter(components.rateLimiter, {
  publicListingReport: { kind: 'token bucket', rate: 3, period: HOUR, capacity: 3 },
})

function slug() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

function clean(value: string, maximum: number, label: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maximum) throw new ConvexError(`${label} is required and must be ${maximum} characters or fewer.`)
  return trimmed
}

function validatedStops(stops: Array<{
  orderIndex: number; title: string; notes: string; placeName?: string; locality?: string
  latitude?: number; longitude?: number; isApproximateLocation: boolean
}>) {
  if (stops.length === 0 || stops.length > 100) throw new ConvexError('Publish between 1 and 100 stops.')
  const seen = new Set<number>()
  return [...stops]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((item, index) => {
      if (!Number.isInteger(item.orderIndex) || item.orderIndex < 0 || seen.has(item.orderIndex)) {
        throw new ConvexError('Each stop needs a unique order.')
      }
      seen.add(item.orderIndex)
      if (item.latitude !== undefined && (item.latitude < -90 || item.latitude > 90)) throw new ConvexError('A stop has invalid latitude.')
      if (item.longitude !== undefined && (item.longitude < -180 || item.longitude > 180)) throw new ConvexError('A stop has invalid longitude.')
      return {
        orderIndex: index,
        title: clean(item.title, 120, 'Stop title'),
        notes: item.notes.trim().slice(0, 1_000),
        placeName: item.placeName?.trim().slice(0, 160) || undefined,
        locality: item.locality?.trim().slice(0, 120) || undefined,
        // Coordinates tagged approximate are never trusted as client-side
        // redactions: omit them entirely from the immutable public snapshot.
        latitude: item.isApproximateLocation ? undefined : item.latitude,
        longitude: item.isApproximateLocation ? undefined : item.longitude,
        isApproximateLocation: item.isApproximateLocation,
      }
    })
}

/** Creates a frozen version from the caller's already-redacted Path payload. */
export const publishForOwner = internalMutation({
  args: {
    ownerAuthUserId: v.string(),
    localPathID: v.string(),
    visibility,
    title: v.string(),
    subtitle: v.string(),
    disclaimer: v.string(),
    approximateLocations: v.boolean(),
    stops: v.array(stop),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId)).unique()
    if (!profile?.handle) throw new ConvexError('Claim a profile handle before publishing a guide.')
    if (args.visibility === 'public' && !profile.isPublic) throw new ConvexError('Turn on your public profile before publishing a public guide.')
    const now = Date.now()
    const existing = await ctx.db.query('publicItineraryListings')
      .withIndex('by_ownerAuthUserId_and_localPathID', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('localPathID', args.localPathID))
      .unique()
    const listingId = existing?._id ?? await ctx.db.insert('publicItineraryListings', {
      ownerAuthUserId: args.ownerAuthUserId,
      localPathID: args.localPathID,
      slug: slug(),
      visibility: args.visibility,
      status: 'published',
      createdAt: now,
      updatedAt: now,
    })
    const versionNumber = existing?.currentVersionId
      ? ((await ctx.db.get(existing.currentVersionId))?.versionNumber ?? 0) + 1
      : 1
    const versionId = await ctx.db.insert('itineraryVersions', {
      listingId,
      versionNumber,
      title: clean(args.title, 120, 'Guide title'),
      subtitle: args.subtitle.trim().slice(0, 280),
      disclaimer: clean(args.disclaimer, 500, 'Guide disclaimer'),
      approximateLocations: args.approximateLocations,
      stops: validatedStops(args.stops),
      createdAt: now,
    })
    await ctx.db.patch(listingId, {
      visibility: args.visibility,
      status: 'published',
      currentVersionId: versionId,
      updatedAt: now,
    })
    return { slug: existing?.slug ?? (await ctx.db.get(listingId))!.slug, handle: profile.handle, versionNumber }
  },
})

export const archiveForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), listingId: v.id('publicItineraryListings') },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get(args.listingId)
    if (!listing || listing.ownerAuthUserId !== args.ownerAuthUserId) throw new ConvexError('Guide not found.')
    await ctx.db.patch(listing._id, { status: 'archived', updatedAt: Date.now() })
    return null
  },
})

export const getPublicProfileByHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const handle = args.handle.trim().toLowerCase()
    let profile = await ctx.db.query('profiles').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
    if (!profile) {
      const alias = await ctx.db.query('profileHandleAliases').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      if (alias) profile = await ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', alias.ownerAuthUserId)).unique()
    }
    if (!profile?.isPublic || !profile.handle) return null
    const listings = await ctx.db.query('publicItineraryListings')
      .withIndex('by_ownerAuthUserId_and_visibility_and_status_and_updatedAt', (q) => q.eq('ownerAuthUserId', profile.ownerAuthUserId).eq('visibility', 'public').eq('status', 'published'))
      .order('desc').take(50)
    return {
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      listings: (await Promise.all(listings.map(async (listing) => {
        const version = listing.currentVersionId ? await ctx.db.get(listing.currentVersionId) : null
        if (!version) return null
        return { slug: listing.slug, title: version.title, subtitle: version.subtitle, stopCount: version.stops.length, updatedAt: listing.updatedAt }
      }))).filter((listing): listing is NonNullable<typeof listing> => listing !== null),
    }
  },
})

export const getPublicListing = internalQuery({
  args: { handle: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const handle = args.handle.trim().toLowerCase()
    let profile = await ctx.db.query('profiles').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
    if (!profile) {
      const alias = await ctx.db.query('profileHandleAliases').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      if (alias) profile = await ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', alias.ownerAuthUserId)).unique()
    }
    if (!profile?.handle) return null
    const listing = await ctx.db.query('publicItineraryListings').withIndex('by_slug', (q) => q.eq('slug', args.slug)).unique()
    if (!listing || listing.ownerAuthUserId !== profile.ownerAuthUserId || listing.status !== 'published') return null
    if (listing.visibility === 'public' && !profile.isPublic) return null
    const version = listing.currentVersionId ? await ctx.db.get(listing.currentVersionId) : null
    if (!version) return null
    return {
      handle: profile.handle,
      displayName: profile.displayName,
      slug: listing.slug,
      visibility: listing.visibility,
      versionNumber: version.versionNumber,
      title: version.title,
      subtitle: version.subtitle,
      disclaimer: version.disclaimer,
      approximateLocations: version.approximateLocations,
      stops: version.stops,
      publishedAt: listing.updatedAt,
    }
  },
})

/** Generic report receipt avoids revealing whether a hidden guide exists. */
export const reportPublicListing = internalMutation({
  args: { listingSlug: v.string(), reason: v.string(), detail: v.optional(v.string()), rateLimitKey: v.string() },
  handler: async (ctx, args) => {
    const reason = clean(args.reason, 120, 'Report reason')
    const listing = await ctx.db.query('publicItineraryListings').withIndex('by_slug', (q) => q.eq('slug', args.listingSlug)).unique()
    if (listing) {
      const { ok } = await reportLimiter.limit(ctx, 'publicListingReport', { key: `${listing._id}:${args.rateLimitKey}` })
      if (!ok) return null
      const duplicate = await ctx.db.query('reports').withIndex('by_listingId_and_reportFingerprint', (q) => q.eq('listingId', listing._id).eq('reportFingerprint', args.rateLimitKey)).unique()
      if (duplicate) return null
      await ctx.db.insert('reports', {
        targetType: 'listing', listingId: listing._id, listingSlug: listing.slug,
        reportFingerprint: args.rateLimitKey,
        reason, detail: args.detail?.trim().slice(0, 1_000) || undefined,
        status: 'open', createdAt: Date.now(),
      })
    }
    return null
  },
})
