import { convexTest } from 'convex-test'
import type { Id } from '../convex/_generated/dataModel'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

describe('legacy owner claim', () => {
  it('claims rows and derives missing request and recommendation totals', async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const journeyId = await t.run((ctx) => ctx.db.insert('journeys', {
      ownerTokenIdentifier: 'legacy|owner-a',
      localID: 'local-journey-a',
      title: 'Penang',
      destination: 'Malaysia',
      updatedAt: now,
    }))
    const requestId = await t.run((ctx) => ctx.db.insert('askRequests', {
      ownerTokenIdentifier: 'legacy|owner-a',
      journeyId,
      localJourneyID: 'local-journey-a',
      slug: 'opaque-slug-a',
      prompt: 'Where should I eat?',
      destination: 'Malaysia',
      status: 'open',
      createdAt: now,
    }))
    await t.run(async (ctx) => {
      await ctx.db.insert('recommendations', {
        askRequestId: requestId, anonymous: false, contributorName: 'Ari', category: 'food',
        place: { provider: 'manual', name: 'Nasi Kandar', latitude: 5.4141, longitude: 100.3288 },
        note: 'Go for lunch.', status: 'pending', submittedAt: now,
      })
      await ctx.db.insert('recommendations', {
        askRequestId: requestId, anonymous: false, contributorName: 'Mina', category: 'culture',
        place: { provider: 'manual', name: 'Khoo Kongsi', latitude: 5.4147, longitude: 100.337 },
        note: 'Worth a visit.', status: 'accepted', acceptedAt: now, submittedAt: now + 1,
      })
    })

    const migration = await t.mutation(internal.migrations.claimLegacyAskData, {
      ownerAuthUserId: 'better-auth-user-a',
      legacyTokenIdentifier: 'legacy|owner-a',
    })

    expect(migration).toMatchObject({ journeys: 1, requests: 1, paths: 0, hasMore: false })
    const journey = await t.run((ctx) => ctx.db.get(journeyId))
    const request = await t.run((ctx) => ctx.db.get(requestId))
    expect(journey).toMatchObject({
      ownerAuthUserId: 'better-auth-user-a',
      askRequestCount: 1,
      openAskRequestCount: 1,
      recommendationCount: 2,
      pendingRecommendationCount: 1,
    })
    expect(journey?.ownerTokenIdentifier).toBeUndefined()
    expect(request).toMatchObject({
      ownerAuthUserId: 'better-auth-user-a',
      recommendationCount: 2,
      pendingRecommendationCount: 1,
    })
    expect(request?.ownerTokenIdentifier).toBeUndefined()
  })

  it('migrates in fixed-size slices and does not claim another owner’s rows', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const ownerA: Id<'journeys'>[] = []
      for (let index = 0; index < 26; index += 1) {
        ownerA.push(await ctx.db.insert('journeys', {
          ownerTokenIdentifier: 'legacy|owner-a', localID: `journey-${index}`, title: 'Trip', updatedAt: index,
        }))
      }
      const ownerB = await ctx.db.insert('journeys', {
        ownerTokenIdentifier: 'legacy|owner-b', localID: 'other', title: 'Other', updatedAt: 100,
      })
      return { ownerA, ownerB }
    })

    const first = await t.mutation(internal.migrations.claimLegacyAskData, {
      ownerAuthUserId: 'better-auth-user-a', legacyTokenIdentifier: 'legacy|owner-a',
    })
    expect(first.journeys).toBe(25)
    expect(first.hasMore).toBe(true)
    const second = await t.mutation(internal.migrations.claimLegacyAskData, {
      ownerAuthUserId: 'better-auth-user-a', legacyTokenIdentifier: 'legacy|owner-a',
    })
    expect(second.journeys).toBe(1)
    expect(second.hasMore).toBe(false)

    const claimed = await t.run(async (ctx) => Promise.all(ids.ownerA.map((id) => ctx.db.get(id))))
    const untouched = await t.run((ctx) => ctx.db.get(ids.ownerB))
    expect(claimed.every((journey) => journey?.ownerAuthUserId === 'better-auth-user-a')).toBe(true)
    expect(untouched?.ownerAuthUserId).toBeUndefined()
    expect(untouched?.ownerTokenIdentifier).toBe('legacy|owner-b')
  })
})
