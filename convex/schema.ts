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
    ownerAuthUserId: v.string(),
    localID: v.string(),
    title: v.string(),
    destination: v.string(),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    askRequestCount: v.number(),
    openAskRequestCount: v.number(),
    recommendationCount: v.number(),
    pendingRecommendationCount: v.number(),
    updatedAt: v.number(),
  }).index('by_ownerAuthUserId_and_localID', ['ownerAuthUserId', 'localID']),

  askRequests: defineTable({
    ownerAuthUserId: v.string(),
    journeyId: v.id('journeys'),
    // The immutable device-side UUID joins an authenticated request back to a
    // local SwiftData Journey. It never appears in a public projection.
    localJourneyID: v.string(),
    slug: v.string(),
    prompt: v.string(),
    destination: v.string(),
    journeyTitle: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('closed')),
    recommendationCount: v.number(),
    pendingRecommendationCount: v.number(),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
    .index('by_ownerAuthUserId_and_createdAt', ['ownerAuthUserId', 'createdAt'])
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
    ownerAuthUserId: v.string(),
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

})
