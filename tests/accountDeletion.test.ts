import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { components, internal } from '../convex/_generated/api'
import betterAuth from '@convex-dev/better-auth/test'

const modules = import.meta.glob('../convex/**/*.ts')

afterEach(() => vi.useRealTimers())

test('account deletion removes owned descendants and leaves another account intact', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const owner = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const other = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Other', email: 'other@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const { ownerID, ownedMediaID, otherMediaID } = await t.run(async (ctx) => {
    const ownerID = String(owner._id)
    const otherID = String(other._id)
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
    await ctx.db.insert('recommendationSubmissions', {
      ownerAuthUserId: ownerID, askRequestId: request,
      submissionIDHash: 'owned-receipt', contentHash: 'owned-content', createdAt: 1,
    })
    await ctx.db.insert('blockedAskContributors', {
      ownerAuthUserId: ownerID, contributorKeyHash: 'owned-contributor', createdAt: 1,
    })
    const otherJourney = await ctx.db.query('journeys')
      .withIndex('by_ownerAuthUserId_and_localID', q => q.eq('ownerAuthUserId', otherID).eq('localID', 'other'))
      .unique()
    if (!otherJourney) throw new Error('Expected the other journey')
    const otherRequest = await ctx.db.insert('askRequests', {
      ownerAuthUserId: otherID, journeyId: otherJourney._id, slug: 'other-ask',
      prompt: 'Where to go?', destination: 'Penang', status: 'open',
      recommendationCount: 0, pendingRecommendationCount: 0, createdAt: 1,
    })
    await ctx.db.insert('recommendationSubmissions', {
      ownerAuthUserId: otherID, askRequestId: otherRequest,
      submissionIDHash: 'other-receipt', contentHash: 'other-content', createdAt: 1,
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
    const ownedMediaID = await ctx.storage.store(new Blob(['owned video'], { type: 'video/mp4' }))
    const otherMediaID = await ctx.storage.store(new Blob(['other video'], { type: 'video/mp4' }))
    await ctx.db.insert('reelImports', {
      ownerAuthUserId: ownerID, idempotencyKey: 'owned-import',
      sourceURL: 'https://www.instagram.com/reel/Owned123/',
      mediaStorageId: ownedMediaID, status: 'awaiting_upload', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('reelImports', {
      ownerAuthUserId: otherID, idempotencyKey: 'other-import',
      mediaStorageId: otherMediaID, status: 'queued', createdAt: 1, updatedAt: 1,
    })
    return { ownerID, ownedMediaID, otherMediaID }
  })

  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId: ownerID })
  await t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: 'user', where: [{ field: '_id', value: ownerID }] } })
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
    reelImports: await ctx.db.query('reelImports').collect(),
    recommendationSubmissions: await ctx.db.query('recommendationSubmissions').collect(),
    blockedAskContributors: await ctx.db.query('blockedAskContributors').collect(),
    ownedMedia: await ctx.db.system.get('_storage', ownedMediaID),
    otherMedia: await ctx.db.system.get('_storage', otherMediaID),
    jobs: await ctx.db.query('accountDeletionJobs').collect(),
  }))
  expect(remaining.journeys.map((row) => row.localID)).toEqual(['other'])
  expect(remaining.requests.map((row) => row.slug)).toEqual(['other-ask'])
  expect(remaining.profiles).toHaveLength(1)
  expect(remaining.profiles[0].ownerAuthUserId).not.toBe(ownerID)
  expect(remaining.reelImports.map((row) => row.idempotencyKey)).toEqual(['other-import'])
  expect(remaining.recommendationSubmissions.map((row) => row.submissionIDHash)).toEqual(['other-receipt'])
  expect(remaining.blockedAskContributors).toHaveLength(0)
  expect(remaining.ownedMedia).toBeNull()
  expect(remaining.otherMedia).not.toBeNull()
  for (const table of ['recommendations', 'paths', 'pathStops', 'listings', 'versions', 'reports', 'moderationActions', 'jobs'] as const) {
    expect(remaining[table]).toHaveLength(0)
  }
})

test('recovery finishes cleanup after auth deletion when the post-delete hook is interrupted', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const owner = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
      name: 'Owner', email: 'owner@example.test', emailVerified: true,
      createdAt: 1, updatedAt: 1,
  } } })
  const ownerID = String(owner._id)
  await t.run(ctx => ctx.db.insert('profiles', { ownerAuthUserId: ownerID, isPublic: true, updatedAt: 1 }))
  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId: ownerID })
  await t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: 'user', where: [{ field: '_id', value: ownerID }] } })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const remaining = await t.run(async (ctx) => ({
    profiles: await ctx.db.query('profiles').collect(),
    jobs: await ctx.db.query('accountDeletionJobs').collect(),
  }))
  expect(remaining.profiles).toHaveLength(0)
  expect(remaining.jobs).toHaveLength(0)
})

test('recovery never purges a still-live Better Auth component account', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const owner = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const ownerAuthUserId = String(owner._id)
  await t.run(ctx => ctx.db.insert('profiles', { ownerAuthUserId, isPublic: true, updatedAt: 1 }))
  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId })
  // Simulate auth deletion failing after beforeDelete prepared its recovery.
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.query('profiles').collect())).toHaveLength(1)
  expect(await t.run(ctx => ctx.db.query('accountDeletionJobs').collect())).toHaveLength(0)
})

test('successful slow auth deletion recreates a purge after recovery released its pending fence', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const owner = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: 'slow-owner@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const ownerAuthUserId = String(owner._id)
  await t.run(ctx => ctx.db.insert('profiles', { ownerAuthUserId, isPublic: true, updatedAt: 1 }))
  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId })
  // Auth still exists when recovery runs: preserve data and release the fence.
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await t.mutation(internal.accountDeletion.activate, { ownerAuthUserId })
  expect(await t.run(ctx => ctx.db.query('accountDeletionJobs').collect())).toHaveLength(0)
  expect(await t.run(ctx => ctx.db.query('profiles').collect())).toHaveLength(1)
  // The same slow request then succeeds and its afterDelete callback arrives.
  await t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: 'user', where: [{ field: '_id', value: ownerAuthUserId }] } })
  await t.mutation(internal.accountDeletion.activate, { ownerAuthUserId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.query('profiles').collect())).toHaveLength(0)
  expect(await t.run(ctx => ctx.db.query('accountDeletionJobs').collect())).toHaveLength(0)
})
