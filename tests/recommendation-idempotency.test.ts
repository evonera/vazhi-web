import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import rateLimiter from '@convex-dev/rate-limiter/test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')
const clientSubmissionID = 'f2e27d7f-4e0a-4d14-b282-05c185c9b3ee'

test('a post-commit lost response retries without another recommendation or count', async () => {
  const t = convexTest(schema, modules)
  rateLimiter.register(t)
  const { journeyID, requestID } = await t.run(async ctx => {
    const journeyID = await ctx.db.insert('journeys', {
      ownerAuthUserId: 'owner-a', localID: 'local-a', title: 'Trip', destination: 'Malaysia',
      askRequestCount: 1, openAskRequestCount: 1, recommendationCount: 0,
      pendingRecommendationCount: 0, updatedAt: 1,
    })
    const requestID = await ctx.db.insert('askRequests', {
      ownerAuthUserId: 'owner-a', journeyId: journeyID, slug: 'ask-a',
      prompt: 'Where should I go?', destination: 'Malaysia', status: 'open',
      recommendationCount: 0, pendingRecommendationCount: 0, createdAt: 1,
    })
    return { journeyID, requestID }
  })
  const args = {
    slug: 'ask-a', rateLimitKey: 'edge-client-a', clientSubmissionID,
    anonymous: false, contributorName: 'Friend', category: 'food' as const,
    place: { provider: 'google' as const, providerPlaceID: 'place-123', name: 'Public Market', latitude: 3.136, longitude: 101.619 },
    note: 'Try the stalls.',
  }

  await t.mutation(internal.requests.submitPublic, args) // Server commits; browser loses its HTTP response.
  await t.run(ctx => ctx.db.patch(requestID, { status: 'closed' }))
  // Google can return refreshed display details on retry. The stable Place ID
  // and user-authored content identify the same submission.
  await expect(t.mutation(internal.requests.submitPublic, {
    ...args, place: { ...args.place, name: 'Updated display name', latitude: 3.137 },
  })).resolves.toBeNull()

  const result = await t.run(async ctx => ({
    journey: await ctx.db.get(journeyID),
    request: await ctx.db.get(requestID),
    recommendations: await ctx.db.query('recommendations').withIndex('by_askRequestId_and_submittedAt', q => q.eq('askRequestId', requestID)).collect(),
    receipts: await ctx.db.query('recommendationSubmissions').withIndex('by_askRequestId_and_submissionIDHash', q => q.eq('askRequestId', requestID)).collect(),
  }))
  expect(result.recommendations).toHaveLength(1)
  expect(result.receipts).toHaveLength(1)
  expect(result.receipts[0].submissionIDHash).toMatch(/^[a-f0-9]{64}$/)
  expect(result.receipts[0].submissionIDHash).not.toBe(clientSubmissionID)
  expect(result.journey?.recommendationCount).toBe(1)
  expect(result.request?.recommendationCount).toBe(1)
  expect(result.request?.pendingRecommendationCount).toBe(1)
  await expect(t.mutation(internal.requests.submitPublic, { ...args, note: 'Changed text.' }))
    .rejects.toThrow('recommendation changed')
})

test('the same opaque client ID is isolated to each owner request', async () => {
  const t = convexTest(schema, modules)
  rateLimiter.register(t)
  await t.run(async ctx => {
    for (const [owner, slug] of [['owner-a', 'ask-a'], ['owner-b', 'ask-b']]) {
      const journeyID = await ctx.db.insert('journeys', {
        ownerAuthUserId: owner, localID: slug, title: 'Trip', destination: 'Malaysia',
        askRequestCount: 1, openAskRequestCount: 1, recommendationCount: 0,
        pendingRecommendationCount: 0, updatedAt: 1,
      })
      await ctx.db.insert('askRequests', {
        ownerAuthUserId: owner, journeyId: journeyID, slug,
        prompt: 'Where should I go?', destination: 'Malaysia', status: 'open',
        recommendationCount: 0, pendingRecommendationCount: 0, createdAt: 1,
      })
    }
  })
  const submission = {
    rateLimitKey: 'edge-client-a', clientSubmissionID,
    anonymous: true, category: 'food' as const,
    place: { provider: 'manual' as const, name: 'Public Market', latitude: 3.136, longitude: 101.619 },
    note: 'Try the stalls.',
  }
  await t.mutation(internal.requests.submitPublic, { ...submission, slug: 'ask-a' })
  await t.mutation(internal.requests.submitPublic, { ...submission, slug: 'ask-b' })
  const counts = await t.run(async ctx => {
    const requests = await ctx.db.query('askRequests').collect()
    return requests.map(request => request.recommendationCount)
  })
  expect(counts).toEqual([1, 1])
})
