import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

afterEach(() => vi.useRealTimers())

test('account deletion removes owned descendants and leaves another account intact', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  const ownerID = await t.run(async (ctx) => {
    const ownerID = await ctx.db.insert('user', {
      name: 'Owner', email: 'owner@example.test', emailVerified: true,
      createdAt: 1, updatedAt: 1,
    })
    const otherID = await ctx.db.insert('user', {
      name: 'Other', email: 'other@example.test', emailVerified: true,
      createdAt: 1, updatedAt: 1,
    })
    const journey = await ctx.db.insert('journeys', {
      ownerAuthUserId: ownerID, localID: 'owned', title: 'Owned', destination: 'Kochi',
      askRequestCount: 1, openAskRequestCount: 1, recommendationCount: 1,
      pendingRecommendationCount: 1, updatedAt: 1,
    })
    await ctx.db.insert('journeys', {
      ownerAuthUserId: otherID, localID: 'other', title: 'Other', destination: 'Penang',
      askRequestCount: 0, openAskRequestCount: 0, recommendationCount: 0,
      pendingRecommendationCount: 0, updatedAt: 1,
    })
    const request = await ctx.db.insert('askRequests', {
      ownerAuthUserId: ownerID, journeyId: journey, slug: 'owned-ask',
      prompt: 'Where to go?', destination: 'Kochi', status: 'open',
      recommendationCount: 1, pendingRecommendationCount: 1, createdAt: 1,
    })
    const recommendation = await ctx.db.insert('recommendations', {
      askRequestId: request, anonymous: false, contributorName: 'Friend',
      category: 'food', place: { provider: 'google', providerPlaceID: 'place-123' },
      note: 'Try it', status: 'pending', submittedAt: 1,
    })
    const path = await ctx.db.insert('paths', {
      ownerAuthUserId: ownerID, journeyId: journey, localPathID: 'path-1',
      title: 'Path', status: 'draft', createdAt: 1,
    })
    await ctx.db.insert('pathStops', {
      pathId: path, recommendationId: recommendation, orderIndex: 0,
      category: 'food', place: { provider: 'google', providerPlaceID: 'place-123' }, notes: '',
    })
    const listing = await ctx.db.insert('publicItineraryListings', {
      ownerAuthUserId: ownerID, localPathID: 'path-1', slug: 'owned-guide',
      visibility: 'public', status: 'published', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('itineraryVersions', {
      listingId: listing, versionNumber: 1, title: 'Guide', destination: 'Kochi',
      subtitle: '', disclaimer: '', approximateLocations: false, stops: [], createdAt: 1,
    })
    const report = await ctx.db.insert('reports', {
      targetType: 'listing', listingId: listing, listingSlug: 'owned-guide',
      reportFingerprint: 'fingerprint', reason: 'Other', status: 'open', createdAt: 1,
    })
    await ctx.db.insert('moderationActions', {
      listingId: listing, reportId: report, action: 'takedown', actor: 'moderation_api', createdAt: 1,
    })
    for (let index = 0; index < 62; index += 1) {
      await ctx.db.insert('profiles', { ownerAuthUserId: ownerID, isPublic: false, updatedAt: index })
    }
    await ctx.db.insert('profiles', { ownerAuthUserId: otherID, isPublic: true, updatedAt: 1 })
    return ownerID
  })

  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId: ownerID })
  await t.run(async (ctx) => ctx.db.delete(ownerID)) // Better Auth deletes the auth user first.
  await t.mutation(internal.accountDeletion.activate, { ownerAuthUserId: ownerID })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  const remaining = await t.run(async (ctx) => ({
    journeys: await ctx.db.query('journeys').collect(),
    requests: await ctx.db.query('askRequests').collect(),
    recommendations: await ctx.db.query('recommendations').collect(),
    paths: await ctx.db.query('paths').collect(),
    pathStops: await ctx.db.query('pathStops').collect(),
    listings: await ctx.db.query('publicItineraryListings').collect(),
    versions: await ctx.db.query('itineraryVersions').collect(),
    reports: await ctx.db.query('reports').collect(),
    moderationActions: await ctx.db.query('moderationActions').collect(),
    profiles: await ctx.db.query('profiles').collect(),
    jobs: await ctx.db.query('accountDeletionJobs').collect(),
  }))
  expect(remaining.journeys.map((row) => row.localID)).toEqual(['other'])
  expect(remaining.profiles).toHaveLength(1)
  expect(remaining.profiles[0].ownerAuthUserId).not.toBe(ownerID)
  for (const table of ['requests', 'recommendations', 'paths', 'pathStops', 'listings', 'versions', 'reports', 'moderationActions', 'jobs'] as const) {
    expect(remaining[table]).toHaveLength(0)
  }
})

test('recovery finishes cleanup after auth deletion when the post-delete hook is interrupted', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  const ownerID = await t.run(async (ctx) => {
    const id = await ctx.db.insert('user', {
      name: 'Owner', email: 'owner@example.test', emailVerified: true,
      createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('profiles', { ownerAuthUserId: id, isPublic: true, updatedAt: 1 })
    return id
  })
  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId: ownerID })
  await t.run(async (ctx) => ctx.db.delete(ownerID))
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const remaining = await t.run(async (ctx) => ({
    profiles: await ctx.db.query('profiles').collect(),
    jobs: await ctx.db.query('accountDeletionJobs').collect(),
  }))
  expect(remaining.profiles).toHaveLength(0)
  expect(remaining.jobs).toHaveLength(0)
})
