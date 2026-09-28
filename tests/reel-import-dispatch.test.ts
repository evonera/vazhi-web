import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
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
