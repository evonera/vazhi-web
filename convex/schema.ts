import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { tables as betterAuthTables } from './betterAuth/schema'

const category = v.union(
  v.literal('food'), v.literal('hidden_spot'), v.literal('stay'),
  v.literal('culture'), v.literal('nature'), v.literal('avoid'), v.literal('other'),
)

const place = v.object({
  provider: v.union(v.literal('google'), v.literal('manual')),
  providerPlaceID: v.optional(v.string()),
  name: v.string(),
  address: v.optional(v.string()),
  latitude: v.number(),
  longitude: v.number(),
  primaryType: v.optional(v.string()),
})

export default defineSchema({
  ...betterAuthTables,
  journeys: defineTable({
    // Keep the former token field during the one-time, self-service claim.
    // This lets an existing deployment accept the schema before its documents
    // are backfilled to Better Auth's opaque user ID.
    ownerAuthUserId: v.optional(v.string()),
    ownerTokenIdentifier: v.optional(v.string()),
    localID: v.string(),
    title: v.string(),
    destination: v.string(),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    askRequestCount: v.optional(v.number()),
    openAskRequestCount: v.optional(v.number()),
    recommendationCount: v.optional(v.number()),
    pendingRecommendationCount: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_ownerAuthUserId_and_localID', ['ownerAuthUserId', 'localID'])
    .index('by_ownerTokenIdentifier_and_localID', ['ownerTokenIdentifier', 'localID']),

  askRequests: defineTable({
    ownerAuthUserId: v.optional(v.string()),
    ownerTokenIdentifier: v.optional(v.string()),
    journeyId: v.id('journeys'),
    // The immutable device-side UUID joins an authenticated request back to a
    // local SwiftData Journey. It never appears in a public projection.
    // Optional during the staged migration: legacy request rows resolve this
    // from their Journey in listForOwner. New rows always write the value.
    localJourneyID: v.optional(v.string()),
    slug: v.string(),
    prompt: v.string(),
    destination: v.string(),
    journeyTitle: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('closed')),
    recommendationCount: v.optional(v.number()),
    pendingRecommendationCount: v.optional(v.number()),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
    .index('by_ownerAuthUserId_and_createdAt', ['ownerAuthUserId', 'createdAt'])
    .index('by_ownerTokenIdentifier_and_createdAt', ['ownerTokenIdentifier', 'createdAt'])
    .index('by_journeyId_and_createdAt', ['journeyId', 'createdAt']),

  recommendations: defineTable({
    askRequestId: v.id('askRequests'),
    anonymous: v.boolean(),
    contributorName: v.optional(v.string()),
    contributorHandle: v.optional(v.string()),
    category,
    place,
    note: v.string(),
    referenceURL: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('accepted'), v.literal('ignored')),
    acceptedAt: v.optional(v.number()),
    submittedAt: v.number(),
  })
    .index('by_askRequestId_and_submittedAt', ['askRequestId', 'submittedAt'])
    .index('by_askRequestId_and_status_and_submittedAt', ['askRequestId', 'status', 'submittedAt']),

  paths: defineTable({
    ownerAuthUserId: v.optional(v.string()),
    ownerTokenIdentifier: v.optional(v.string()),
    journeyId: v.id('journeys'),
    title: v.string(),
    status: v.literal('draft'),
    createdAt: v.number(),
  }).index('by_journeyId_and_createdAt', ['journeyId', 'createdAt']),

  pathStops: defineTable({
    pathId: v.id('paths'),
    recommendationId: v.id('recommendations'),
    orderIndex: v.number(),
    category,
    place,
    notes: v.string(),
  }).index('by_pathId_and_orderIndex', ['pathId', 'orderIndex']),

  syncedOutboxJobs: defineTable({
    ownerAuthUserId: v.string(),
    jobId: v.string(),
    actionType: v.string(),
    completedAt: v.number(),
  }).index('by_ownerAuthUserId_and_jobId', ['ownerAuthUserId', 'jobId']),

  // Cloud records mirror selected private journal metadata. Media files never
  // travel through this table: their local paths are intentionally absent.
  syncedJourneys: defineTable({
    ownerAuthUserId: v.string(),
    localJourneyId: v.string(),
    title: v.string(),
    summaryText: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index('by_ownerAuthUserId_and_localJourneyId', ['ownerAuthUserId', 'localJourneyId']),

  syncedMoments: defineTable({
    ownerAuthUserId: v.string(),
    localMomentId: v.string(),
    localJourneyId: v.string(),
    capturedAt: v.string(),
    note: v.string(),
    syncState: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    placeName: v.optional(v.string()),
    locality: v.optional(v.string()),
    country: v.optional(v.string()),
    placeSource: v.optional(v.string()),
    placeProviderID: v.optional(v.string()),
    formattedAddress: v.optional(v.string()),
    placePrimaryType: v.optional(v.string()),
    assetKinds: v.array(v.string()),
    updatedAt: v.number(),
  }).index('by_ownerAuthUserId_and_localMomentId', ['ownerAuthUserId', 'localMomentId']),

  // Privacy-safe observability for optional AI requests. This table contains
  // no source text, coordinates, media, prompt, transcript, provider payload,
  // or provider response; it is only a bounded account-level usage receipt.
  aiUsageEvents: defineTable({
    ownerAuthUserId: v.string(),
    provider: v.string(),
    model: v.string(),
    outcome: v.union(v.literal('success'), v.literal('rejected'), v.literal('failed')),
    createdAt: v.number(),
  }).index('by_ownerAuthUserId_and_createdAt', ['ownerAuthUserId', 'createdAt']),

  // A redacted server-side receipt of a verified provider event. Never store
  // its raw body, subscriber attributes, aliases, price, country, transaction
  // IDs, or a provider secret. It supports support/quota diagnostics only;
  // native RevenueCat CustomerInfo decides a user's entitlement.
  providerEvents: defineTable({
    source: v.literal('revenuecat'),
    eventID: v.string(),
    eventType: v.string(),
    occurredAt: v.number(),
    appUserID: v.optional(v.string()),
    environment: v.optional(v.string()),
    store: v.optional(v.string()),
    entitlementIDs: v.array(v.string()),
    receivedAt: v.number(),
  }).index('by_source_and_eventID', ['source', 'eventID']),

  // An idempotency receipt for low-priority work. Arguments, route polylines,
  // and source content belong in the work item/action, never in this log.
  backgroundJobs: defineTable({
    ownerAuthUserId: v.string(),
    idempotencyKey: v.string(),
    kind: v.literal('route_snapshot_refresh'),
    state: v.union(v.literal('queued'), v.literal('completed'), v.literal('failed')),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index('by_ownerAuthUserId_and_idempotencyKey', ['ownerAuthUserId', 'idempotencyKey']),

  // Profiles are opt-in. No Journey, Moment, email, Apple subject, or billing
  // metadata is ever a public profile field.
  profiles: defineTable({
    ownerAuthUserId: v.string(),
    handle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    isPublic: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_ownerAuthUserId', ['ownerAuthUserId'])
    .index('by_handle', ['handle']),

  profileHandleAliases: defineTable({
    ownerAuthUserId: v.string(),
    handle: v.string(),
    createdAt: v.number(),
  }).index('by_handle', ['handle']),

  // Public guides are an explicit, immutable projection. They never point at
  // live Journeys, Moments, media, transcripts, or source coordinates.
  publicItineraryListings: defineTable({
    ownerAuthUserId: v.string(),
    localPathID: v.string(),
    slug: v.string(),
    visibility: v.union(v.literal('public'), v.literal('unlisted')),
    status: v.union(v.literal('published'), v.literal('archived'), v.literal('takedown')),
    currentVersionId: v.optional(v.id('itineraryVersions')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_ownerAuthUserId_and_localPathID', ['ownerAuthUserId', 'localPathID'])
    .index('by_ownerAuthUserId_and_status_and_updatedAt', ['ownerAuthUserId', 'status', 'updatedAt'])
    .index('by_ownerAuthUserId_and_visibility_and_status_and_updatedAt', ['ownerAuthUserId', 'visibility', 'status', 'updatedAt']),

  itineraryVersions: defineTable({
    listingId: v.id('publicItineraryListings'),
    versionNumber: v.number(),
    title: v.string(),
    subtitle: v.string(),
    disclaimer: v.string(),
    approximateLocations: v.boolean(),
    stops: v.array(v.object({
      orderIndex: v.number(),
      title: v.string(),
      notes: v.string(),
      placeName: v.optional(v.string()),
      locality: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      isApproximateLocation: v.boolean(),
    })),
    createdAt: v.number(),
  }).index('by_listingId_and_versionNumber', ['listingId', 'versionNumber']),

  reports: defineTable({
    targetType: v.literal('listing'),
    listingId: v.optional(v.id('publicItineraryListings')),
    listingSlug: v.string(),
    // A salted one-way edge bucket, never a raw IP address. It deduplicates
    // repeated reports for one guide without becoming product identity data.
    reportFingerprint: v.string(),
    reason: v.string(),
    detail: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('reviewed'), v.literal('dismissed')),
    createdAt: v.number(),
  })
    .index('by_listingId_and_createdAt', ['listingId', 'createdAt'])
    .index('by_listingId_and_reportFingerprint', ['listingId', 'reportFingerprint']),

})
