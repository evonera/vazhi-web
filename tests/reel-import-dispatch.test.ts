import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

test('worker payload always selects exactly one media input', async () => {
  const t = convexTest(schema, modules)
  const { linkID, uploadID, fallbackID } = await t.run(async (ctx) => {
    const mediaStorageId = await ctx.storage.store(new Blob(['video'], { type: 'video/mp4' }))
    const base = { ownerAuthUserId: 'owner', status: 'queued' as const, createdAt: 1, updatedAt: 1 }
    const linkID = await ctx.db.insert('reelImports', {
      ...base, idempotencyKey: 'link', sourceURL: 'https://www.instagram.com/reel/Link123/',
    })
    const uploadID = await ctx.db.insert('reelImports', {
      ...base, idempotencyKey: 'upload', mediaStorageId,
    })
    const fallbackID = await ctx.db.insert('reelImports', {
      ...base, idempotencyKey: 'fallback', sourceURL: 'https://www.instagram.com/reel/Link123/', mediaStorageId,
    })
    return { linkID, uploadID, fallbackID }
  })

  const link = await t.query(internal.imports.dispatchPayload, { importId: linkID })
  const upload = await t.query(internal.imports.dispatchPayload, { importId: uploadID })
  const fallback = await t.query(internal.imports.dispatchPayload, { importId: fallbackID })

  expect(link?.sourceURL).toBe('https://www.instagram.com/reel/Link123/')
  expect(link?.mediaURL).toBeNull()
  expect(upload?.sourceURL).toBeNull()
  expect(upload?.mediaURL).toBeTruthy()
  expect(fallback?.sourceURL).toBeNull()
  expect(fallback?.mediaURL).toBe(upload?.mediaURL)
  const storedFallback = await t.run((ctx) => ctx.db.get(fallbackID))
  expect(storedFallback?.sourceURL).toBe('https://www.instagram.com/reel/Link123/')
})

test('invalid stored media cannot consume an import retry; a valid upload commits once', async () => {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const { importID, invalidStorageID, validStorageID } = await t.run(async (ctx) => {
    const importID = await ctx.db.insert('reelImports', {
      ownerAuthUserId: 'owner', idempotencyKey: 'fallback',
      sourceURL: 'https://www.instagram.com/reel/Link123/',
      status: 'needs_media', createdAt: 1, updatedAt: 1,
    })
    const invalidStorageID = await ctx.storage.store(new Blob(['not video'], { type: 'text/plain' }))
    const validStorageID = await ctx.storage.store(new Blob(['video'], { type: 'video/mp4' }))
    return { importID, invalidStorageID, validStorageID }
  })
  await expect(t.mutation(internal.imports.commitVideoUploadForOwner, {
    ownerAuthUserId: 'owner', importId: importID, storageId: invalidStorageID, contentType: 'text/plain',
  })).rejects.toThrow()
  const before = await t.run((ctx) => ctx.db.get(importID))
  expect(before?.uploadAttemptCount).toBeUndefined()
  expect(before?.status).toBe('needs_media')
  const accepted = await t.mutation(internal.imports.commitVideoUploadForOwner, {
    ownerAuthUserId: 'owner', importId: importID, storageId: validStorageID, contentType: 'video/mp4',
  })
  expect(accepted?.accepted).toBe(true)
  const after = await t.run((ctx) => ctx.db.get(importID))
  expect(after?.uploadAttemptCount).toBe(1)
  expect(after?.status).toBe('queued')
  expect(after?.mediaStorageId).toBe(validStorageID)
  const duplicate = await t.mutation(internal.imports.commitVideoUploadForOwner, {
    ownerAuthUserId: 'owner', importId: importID, storageId: validStorageID, contentType: 'video/mp4',
  })
  expect(duplicate?.accepted).toBe(false)
  const otherOwner = await t.mutation(internal.imports.commitVideoUploadForOwner, {
    ownerAuthUserId: 'other', importId: importID, storageId: validStorageID, contentType: 'video/mp4',
  })
  expect(otherOwner).toBeNull()
  expect((await t.run((ctx) => ctx.db.get(importID)))?.uploadAttemptCount).toBe(1)
})
