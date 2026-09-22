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
    ownerTokenIdentifier: v.string(),
    localID: v.string(),
    title: v.string(),
    destination: v.string(),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_ownerTokenIdentifier_and_localID', ['ownerTokenIdentifier', 'localID']),

  askRequests: defineTable({
    ownerTokenIdentifier: v.string(),
    journeyId: v.id('journeys'),
    slug: v.string(),
    prompt: v.string(),
    destination: v.string(),
    journeyTitle: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('closed')),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
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
    submittedAt: v.number(),
  })
    .index('by_askRequestId_and_submittedAt', ['askRequestId', 'submittedAt'])
    .index('by_askRequestId_and_status_and_submittedAt', ['askRequestId', 'status', 'submittedAt']),

  paths: defineTable({
    ownerTokenIdentifier: v.string(),
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
})
