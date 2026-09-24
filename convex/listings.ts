import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { internalMutation, internalQuery } from './_generated/server'
import { RateLimiter, HOUR } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'
import { clean, sanitizePublicGuideStops } from './publicGuideSanitization'
import { isDuplicateOpenReport, latestTakedownReportId, ownerMayTransitionListingStatus, reportHasActiveTakedown } from './moderationPolicy'

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

/** Creates a frozen version from the caller's already-redacted Path payload. */
export const publishForOwner = internalMutation({
  args: {
    ownerAuthUserId: v.string(),
    localPathID: v.string(),
    privacyReviewed: v.literal(true),
    visibility,
    title: v.string(),
    destination: v.string(),
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
    if (!ownerMayTransitionListingStatus(existing?.status)) {
      throw new ConvexError('This guide was taken down by moderation and cannot be republished. Contact Vazhi support for review.')
    }
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
      destination: clean(args.destination, 120, 'Guide destination'),
      subtitle: args.subtitle.trim().slice(0, 280),
      disclaimer: clean(args.disclaimer, 500, 'Guide disclaimer'),
      approximateLocations: args.approximateLocations,
      stops: sanitizePublicGuideStops(args.stops),
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
  args: { ownerAuthUserId: v.string(), localPathID: v.string() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.query('publicItineraryListings')
      .withIndex('by_ownerAuthUserId_and_localPathID', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('localPathID', args.localPathID))
      .unique()
    if (!listing) throw new ConvexError('Guide not found.')
    if (!ownerMayTransitionListingStatus(listing.status)) {
      throw new ConvexError('This guide was taken down by moderation and can only be restored by a moderator.')
    }
    await ctx.db.patch(listing._id, { status: 'archived', updatedAt: Date.now() })
    return null
  },
})

export const getOwnerListing = internalQuery({
  args: { ownerAuthUserId: v.string(), localPathID: v.string() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.query('publicItineraryListings')
      .withIndex('by_ownerAuthUserId_and_localPathID', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('localPathID', args.localPathID))
      .unique()
    if (!listing || listing.status !== 'published' || !listing.currentVersionId) return null
    const [profile, version] = await Promise.all([
      ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId)).unique(),
      ctx.db.get(listing.currentVersionId),
    ])
    if (!profile?.handle || !version) return null
    return { handle: profile.handle, slug: listing.slug, versionNumber: version.versionNumber, visibility: listing.visibility }
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
        return { slug: listing.slug, title: version.title, destination: version.destination ?? '', subtitle: version.subtitle, stopCount: version.stops.length, updatedAt: version.createdAt }
      }))).filter((listing): listing is NonNullable<typeof listing> => listing !== null),
    }
  },
})

export const getPublicListing = internalQuery({
  args: { handle: v.string(), slug: v.string(), versionNumber: v.optional(v.number()) },
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
    const version = args.versionNumber === undefined
      ? (listing.currentVersionId ? await ctx.db.get(listing.currentVersionId) : null)
      : await ctx.db.query('itineraryVersions')
        .withIndex('by_listingId_and_versionNumber', (q) => q.eq('listingId', listing._id).eq('versionNumber', args.versionNumber!))
        .unique()
    if (!version) return null
    return {
      handle: profile.handle,
      displayName: profile.displayName,
      slug: listing.slug,
      visibility: listing.visibility,
      versionNumber: version.versionNumber,
      title: version.title,
      destination: version.destination ?? '',
      subtitle: version.subtitle,
      disclaimer: version.disclaimer,
      approximateLocations: version.approximateLocations,
      stops: version.stops,
      // A numbered guide URL is an immutable snapshot; its timestamp must be
      // frozen too, rather than changing when a later version is published.
      publishedAt: version.createdAt,
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
      // Only coalesce retries while a matching report is still awaiting
      // moderation. Once dismissed or reviewed, the same reporter may submit
      // a new report about the still-published guide.
      const duplicate = await ctx.db.query('reports')
        .withIndex('by_listingId_and_status_and_reportFingerprint', (q) => q
          .eq('listingId', listing._id)
          .eq('status', 'open')
          .eq('reportFingerprint', args.rateLimitKey))
        .first()
      if (isDuplicateOpenReport(duplicate?.status)) return null
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

/** Server-only moderation queue. The HTTP boundary requires a separate secret. */
export const listModerationQueue = internalQuery({
  args: {
    openReportsPagination: paginationOptsValidator,
    takedownListingsPagination: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const openReportsPage = await ctx.db.query('reports')
      .withIndex('by_status_and_createdAt', (q) => q.eq('status', 'open'))
      .order('desc').paginate(args.openReportsPagination)
    const takenDownListingsPage = await ctx.db.query('publicItineraryListings')
      .withIndex('by_status_and_updatedAt', (q) => q.eq('status', 'takedown'))
      .order('desc').paginate(args.takedownListingsPagination)
    const activeTakedownReports = []
    for (const listing of takenDownListingsPage.page) {
      // Prefer the explicit active report. For listings taken down before
      // this field existed, recover from the newest takedown action (not the
      // newest action of any kind, which may be a decision on another report).
      const legacyActions = listing.activeTakedownReportId ? [] : await ctx.db.query('moderationActions')
        .withIndex('by_listingId_and_createdAt', (q) => q.eq('listingId', listing._id))
        .order('desc').take(100)
      const reportId = listing.activeTakedownReportId ?? latestTakedownReportId(legacyActions)
      if (!reportId) continue
      const reportActions = await ctx.db.query('moderationActions')
        .withIndex('by_reportId_and_createdAt', (q) => q.eq('reportId', reportId))
        .order('desc').take(1)
      if (!reportHasActiveTakedown(reportActions)) continue
      const report = await ctx.db.get(reportId)
      if (report?.status === 'reviewed') activeTakedownReports.push(report)
    }
    const hydrate = async (report: typeof openReportsPage.page[number]) => {
      const listing = report.listingId ? await ctx.db.get(report.listingId) : null
      const actions = await ctx.db.query('moderationActions')
        .withIndex('by_reportId_and_createdAt', (q) => q.eq('reportId', report._id))
        .order('desc').take(1)
      return {
        id: report._id,
        listingSlug: report.listingSlug,
        listingStatus: listing?.status ?? 'unavailable',
        reportStatus: report.status,
        canRestore: listing?.status === 'takedown' && reportHasActiveTakedown(actions),
        reason: report.reason,
        detail: report.detail,
        createdAt: report.createdAt,
      }
    }
    return {
      openReports: {
        ...openReportsPage,
        page: await Promise.all(openReportsPage.page.map(hydrate)),
      },
      activeTakedowns: {
        ...takenDownListingsPage,
        page: await Promise.all(activeTakedownReports.map(hydrate)),
      },
    }
  },
})

/** Append an auditable decision and hide a guide immediately on takedown. */
export const resolveModerationReport = internalMutation({
  args: {
    reportId: v.id('reports'),
    action: v.union(v.literal('dismiss'), v.literal('takedown'), v.literal('restore')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId)
    if (!report) throw new ConvexError('Report not found.')
    const listing = report.listingId ? await ctx.db.get(report.listingId) : null
    const reportActions = await ctx.db.query('moderationActions')
      .withIndex('by_reportId_and_createdAt', (q) => q.eq('reportId', report._id))
      .order('desc').take(20)
    const isRestoringThisReportTakedown = args.action === 'restore' &&
      report.status === 'reviewed' &&
      listing?.status === 'takedown' &&
      reportHasActiveTakedown(reportActions)

    if (args.action === 'restore') {
      if (!isRestoringThisReportTakedown) {
        throw new ConvexError('Only the active takedown report can restore a taken-down guide.')
      }
    } else if (report.status !== 'open') {
      throw new ConvexError('Report has already been resolved.')
    }
    if (args.action !== 'dismiss' && !listing) throw new ConvexError('Guide is unavailable.')
    if (args.action === 'takedown' && listing?.status === 'takedown') {
      throw new ConvexError('This guide is already taken down.')
    }

    const now = Date.now()
    const previousListingStatus = listing?.status
    if (args.action === 'takedown' && listing) {
      await ctx.db.patch(listing._id, {
        status: 'takedown',
        activeTakedownReportId: report._id,
        updatedAt: now,
      })
    } else if (args.action === 'restore' && listing) {
      const priorDecision = reportActions[0]
      await ctx.db.patch(listing._id, {
        status: priorDecision?.previousListingStatus ?? 'published',
        activeTakedownReportId: undefined,
        updatedAt: now,
      })
    }

    await ctx.db.patch(report._id, {
      status: args.action === 'dismiss' ? 'dismissed' : 'reviewed',
    })
    await ctx.db.insert('moderationActions', {
      listingId: listing?._id,
      reportId: report._id,
      action: args.action,
      previousListingStatus,
      note: args.note?.trim().slice(0, 1_000) || undefined,
      actor: 'moderation_api',
      createdAt: now,
    })
    return null
  },
})
