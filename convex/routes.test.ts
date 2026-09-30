/// <reference types="vite/client" />
import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const encodedPolyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
const validSnapshot = { distanceMeters: 0, duration: '0s', encodedPolyline,
  legs: [{ distanceMeters: 0, duration: '0s' }], generatedAt: 1 }

async function setup() {
  const t = convexTest(schema, modules)
  const pathId = await t.run(async (ctx) => {
    const pathId = await ctx.db.insert('paths', {
      ownerAuthUserId: 'owner-a', title: 'Route', status: 'draft', createdAt: 1, routeRevision: 2,
    })
    for (const orderIndex of [0, 1]) await ctx.db.insert('privateRouteStops', {
      pathId, ownerAuthUserId: 'owner-a', localStopID: `stop-${orderIndex}`, orderIndex,
      provider: 'manual', latitude: 1 + orderIndex, longitude: 2,
    })
    return pathId
  })
  const args = { ownerAuthUserId: 'owner-a', pathId, routeRevision: 2, travelMode: 'WALK' as const }
  return { t, args }
}

test('save uses server time and a valid zero-length snapshot remains cacheable', async () => {
  const { t, args } = await setup()
  const saved = await t.mutation(internal.routes.saveSnapshotForOwner, { ...args, snapshot: validSnapshot })
  const now = Date.now()
  expect(saved.generatedAt).toBeGreaterThan(now - 10_000)
  const cache = await t.query(internal.routes.latestSnapshotForOwner, {
    ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId, travelMode: args.travelMode, now,
  })
  expect(cache).toEqual(saved)
  const rows = await t.run(ctx => ctx.db.query('routeSnapshots').collect())
  expect(rows).toHaveLength(1)
  expect(rows[0].expiresAt).toBe(saved.generatedAt + 5 * 60_000)
})

test('legacy malformed cache is a miss, and a valid retry replaces it', async () => {
  const { t, args } = await setup()
  await t.run(ctx => ctx.db.insert('routeSnapshots', {
    ...args, distanceMeters: 10, duration: '10s', encodedPolyline,
    legs: [{ distanceMeters: 10, duration: '0s' }],
    generatedAt: Date.now(), expiresAt: Date.now() + 60_000,
  }))
  // Same schema but invalid geometry must not be returned to an iPhone.
  const row = await t.run(async ctx => (await ctx.db.query('routeSnapshots').collect())[0]!)
  await t.run(ctx => ctx.db.patch(row._id, { encodedPolyline: encodedPolyline.slice(0, -1) }))
  const cacheArgs = { ownerAuthUserId: args.ownerAuthUserId, pathId: args.pathId,
    travelMode: args.travelMode, now: Date.now() }
  expect(await t.query(internal.routes.latestSnapshotForOwner, cacheArgs)).toBeNull()
  const saved = await t.mutation(internal.routes.saveSnapshotForOwner, { ...args, snapshot: validSnapshot })
  expect(await t.query(internal.routes.latestSnapshotForOwner, { ...cacheArgs, now: Date.now() })).toEqual(saved)
  expect(await t.run(ctx => ctx.db.query('routeSnapshots').collect())).toHaveLength(1)
})

test('save rejects a wrong leg count and stale route revisions', async () => {
  const { t, args } = await setup()
  await expect(t.mutation(internal.routes.saveSnapshotForOwner, {
    ...args, snapshot: { ...validSnapshot, legs: [] },
  })).rejects.toThrow('incomplete route')
  await expect(t.mutation(internal.routes.saveSnapshotForOwner, {
    ...args, routeRevision: 1, snapshot: validSnapshot,
  })).rejects.toThrow('Path changed')
  await expect(t.mutation(internal.routes.saveSnapshotForOwner, {
    ...args, snapshot: { ...validSnapshot, legs: [{ distanceMeters: 0, duration: '315576000001s' }] },
  })).rejects.toThrow('incomplete route')
})

test('a different owner cannot save or read a Path route snapshot', async () => {
  const { t, args } = await setup()
  await expect(t.mutation(internal.routes.saveSnapshotForOwner, {
    ...args, ownerAuthUserId: 'owner-b', snapshot: validSnapshot,
  })).rejects.toThrow('Path not found')
  expect(await t.run(ctx => ctx.db.query('routeSnapshots').collect())).toHaveLength(0)

  await t.mutation(internal.routes.saveSnapshotForOwner, { ...args, snapshot: validSnapshot })
  await expect(t.query(internal.routes.latestSnapshotForOwner, {
    ownerAuthUserId: 'owner-b', pathId: args.pathId, travelMode: args.travelMode, now: Date.now(),
  })).rejects.toThrow('Path not found')
})
