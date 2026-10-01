import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import rateLimiter from '@convex-dev/rate-limiter/test'
import betterAuth from '@convex-dev/better-auth/test'
import schema from '../convex/schema'
import { components, internal } from '../convex/_generated/api'
import { sha256Hex } from '../src/lib/recommendationSubmission'

const modules = import.meta.glob('../convex/**/*.ts')

test('owner reports hide a recommendation and moderation takedown hides it from the inbox', async () => {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  rateLimiter.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: 'moderation-owner@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const ownerAuthUserId = String(user._id)
  const blockedIdentity = 'f2e27d7f-4e0a-4d14-b282-05c185c9b3ee'
  const reportIdentity = '3f9f4bd3-4f3a-4f92-9cf2-99239bd41943'
  const blockedHash = await sha256Hex(`${ownerAuthUserId}:${blockedIdentity}`)
  const reportHash = await sha256Hex(`${ownerAuthUserId}:${reportIdentity}`)
  const ids = await t.run(async ctx => {
    const journeyId = await ctx.db.insert('journeys', {
      ownerAuthUserId, localID: 'journey', title: 'Trip', destination: 'Tokyo',
      askRequestCount: 1, openAskRequestCount: 1, recommendationCount: 2,
      pendingRecommendationCount: 2, updatedAt: 1,
    })
    const requestId = await ctx.db.insert('askRequests', {
      ownerAuthUserId, journeyId, slug: 'ask-tokyo', prompt: 'Where should I go?', destination: 'Tokyo',
      status: 'open', recommendationCount: 2, pendingRecommendationCount: 2, createdAt: 1,
    })
    const makeRecommendation = (contributorKeyHash: string, note: string) => ctx.db.insert('recommendations', {
      askRequestId: requestId, contributorKeyHash, anonymous: true, category: 'food',
      place: { provider: 'manual', name: 'Public place', latitude: 35.6, longitude: 139.7 },
      note, status: 'pending', submittedAt: Date.now(),
    })
    return {
      requestId,
      blockedId: await makeRecommendation(blockedHash, 'Try this place.'),
      reportId: await makeRecommendation(reportHash, 'An offensive note.'),
    }
  })

  await t.mutation(internal.requests.blockRecommendationContributorForOwner, {
    ownerAuthUserId, recommendationId: ids.blockedId,
  })
  await t.mutation(internal.requests.reportRecommendationForOwner, {
    ownerAuthUserId, recommendationId: ids.reportId, reason: 'Inappropriate or offensive',
  })
  const report = await t.run(ctx => ctx.db.query('reports')
    .withIndex('by_recommendationId_and_status_and_reportFingerprint', q => q.eq('recommendationId', ids.reportId).eq('status', 'open'))
    .first())
  expect(report?.targetType).toBe('recommendation')
  expect(report?.askRequestId).toBe(ids.requestId)
  expect(await t.query(internal.requests.listRecommendationsForOwner, {
    ownerAuthUserId, requestId: ids.requestId,
  })).toEqual([])

  const beforeTakedown = await t.run(async ctx => ({
    recommendation: await ctx.db.get(ids.reportId),
    request: await ctx.db.get(ids.requestId),
    journey: await ctx.db.query('journeys').withIndex('by_ownerAuthUserId_and_localID', q => q.eq('ownerAuthUserId', ownerAuthUserId).eq('localID', 'journey')).unique(),
  }))
  expect(beforeTakedown.recommendation?.hiddenByOwner).toBe(true)
  expect(beforeTakedown.request?.pendingRecommendationCount).toBe(0)
  expect(beforeTakedown.journey?.pendingRecommendationCount).toBe(0)

  await t.mutation(internal.listings.resolveModerationReport, {
    reportId: report!._id, action: 'takedown', note: 'Confirmed offensive content',
  })
  const afterTakedown = await t.run(ctx => ctx.db.get(ids.reportId))
  expect(afterTakedown?.hiddenByModeration).toBe(true)

  await t.mutation(internal.requests.submitPublic, {
    slug: 'ask-tokyo', rateLimitKey: 'test-rate-key', contributorID: blockedIdentity,
    anonymous: true, category: 'food',
    place: { provider: 'manual', name: 'Another public place', latitude: 35.61, longitude: 139.71 },
    note: 'This blocked sender should not create a new row.',
  })
  const recommendationCount = await t.run(async ctx => (await ctx.db.query('recommendations')
    .withIndex('by_askRequestId_and_submittedAt', q => q.eq('askRequestId', ids.requestId)).collect()).length)
  expect(recommendationCount).toBe(2)
})
