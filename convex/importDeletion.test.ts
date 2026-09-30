/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuth from '@convex-dev/better-auth/test'
import schema from './schema'
import { components, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.useRealTimers())

test('a deletion fence stops uploads and worker writes before the reel purge reaches them', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: 'owner@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const ownerAuthUserId = String(user._id)
  const { importId, resolvingId, storageId } = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['video'], { type: 'video/mp4' }))
    const importId = await ctx.db.insert('reelImports', {
      ownerAuthUserId, idempotencyKey: 'queued', mediaStorageId: storageId,
      status: 'queued', dispatchAttempt: 1, createdAt: 1, updatedAt: 1,
    })
    const resolvingId = await ctx.db.insert('reelImports', {
      ownerAuthUserId, idempotencyKey: 'resolving', status: 'resolving_places',
      candidates: [], createdAt: 1, updatedAt: 1,
    })
    return { importId, resolvingId, storageId }
  })
  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId })
  await expect(t.mutation(internal.imports.commitVideoUploadForOwner, {
    ownerAuthUserId, storageId, importId, contentType: 'video/mp4',
  })).rejects.toThrow('account')
  await expect(t.mutation(internal.imports.createLinkForOwner, {
    ownerAuthUserId, idempotencyKey: 'd5f40d21-3614-4bd9-aa3d-84e718fa156a',
    sourceURL: 'https://www.instagram.com/reel/Travel123/',
  })).rejects.toThrow('account')
  expect(await t.query(internal.imports.dispatchPayload, { importId })).toBeNull()
  expect(await t.query(internal.imports.candidatesForResolution, { importId: resolvingId })).toBeNull()
  expect(await t.mutation(internal.imports.acceptCallback, {
    importId, attempt: 1, status: 'completed', candidates: [],
  })).toBe(false)
  await t.mutation(internal.imports.markDispatched, { importId, attempt: 1 })
  await t.mutation(internal.imports.savePlaceIDs, { importId: resolvingId, placeIDs: [] })
  expect((await t.run(ctx => ctx.db.get(importId)))?.status).toBe('queued')
  expect((await t.run(ctx => ctx.db.get(resolvingId)))?.status).toBe('resolving_places')
  await t.mutation(components.betterAuth.adapter.deleteOne, { input: {
    model: 'user', where: [{ field: '_id', value: ownerAuthUserId }],
  } })
  await t.mutation(internal.accountDeletion.activate, { ownerAuthUserId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.system.get('_storage', storageId))).toBeNull()
  expect(await t.mutation(internal.imports.acceptCallback, { importId, attempt: 1, status: 'processing' })).toBe(false)
  // An HTTP upload can finish after every cleanup batch and its fence are gone.
  // The real user liveness check still rejects it instead of recreating data.
  const lateStorageId = await t.run(ctx => ctx.storage.store(new Blob(['late video'], { type: 'video/mp4' })))
  await expect(t.mutation(internal.imports.commitVideoUploadForOwner, {
    ownerAuthUserId, storageId: lateStorageId, contentType: 'video/mp4',
    idempotencyKey: 'd5f40d21-3614-4bd9-aa3d-84e718fa156a',
  })).rejects.toThrow('account')
  // The HTTP boundary deletes rejected temporary uploads; no record was made.
  expect(await t.run(ctx => ctx.db.query('reelImports').collect())).toHaveLength(0)
})
