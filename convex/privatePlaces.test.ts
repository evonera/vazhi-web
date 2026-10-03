/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuth from '@convex-dev/better-auth/test'
import schema from './schema'
import { components, internal } from './_generated/api'
import { parsePrivatePlacePayload } from './privatePlacesValidation'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.useRealTimers())
async function setup() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Owner', email: `${crypto.randomUUID()}@example.test`, emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  return { t, ownerAuthUserId: String(user._id) }
}
const place = JSON.stringify({ provider: 'google', providerID: 'place-123', label: 'My weekend idea', note: '', provenance: 'saved', categories: [] })
function operation(ownerAuthUserId: string, overrides = {}) {
  return { ownerAuthUserId, operationID: crypto.randomUUID(), kind: 'place' as const, id: 'google:place-123', expectedRevision: 0, payloadJSON: place, deleted: false, ...overrides }
}

test('private places replay idempotently and stale edits retain the server version', async () => {
  const { t, ownerAuthUserId } = await setup()
  const first = operation(ownerAuthUserId)
  const saved = await t.mutation(internal.privatePlaces.push, first)
  expect(await t.mutation(internal.privatePlaces.push, first)).toEqual(saved)
  const conflict = await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId))
  expect(conflict).toMatchObject({ conflict: true, record: { revision: 1, deleted: false } })
  const deletion = await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, { expectedRevision: 1, deleted: true }))
  expect(deletion.record?.deleted).toBe(true)
  expect(await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, { expectedRevision: 1 }))).toMatchObject({ conflict: true, record: { deleted: true } })
})

test('membership cannot attach another account’s List and deltas stay private', async () => {
  const { t, ownerAuthUserId } = await setup()
  await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId))
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: 'user', data: {
    name: 'Other', email: 'other@example.test', emailVerified: true, createdAt: 1, updatedAt: 1,
  } } })
  const other = String(user._id)
  await t.mutation(internal.privatePlaces.push, operation(other, { kind: 'list', id: 'list-one', payloadJSON: JSON.stringify({ name: 'Private' }) }))
  expect(await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, {
    kind: 'membership', id: 'list-one|google:place-123', payloadJSON: JSON.stringify({ listID: 'list-one', placeID: 'google:place-123', order: 0 }),
  }))).toMatchObject({ conflict: true, record: { deleted: true } })
  const delta = await t.query(internal.privatePlaces.changes, { ownerAuthUserId, after: 0 })
  expect(delta.records).toHaveLength(1)
  expect(delta.records[0]?.kind).toBe('place')
})

test('private deltas paginate beyond 100 imported places without omissions', async () => {
  const { t, ownerAuthUserId } = await setup()
  for (let i = 0; i < 105; i++) {
    await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, {
      id: `google:place-${i}`, payloadJSON: JSON.stringify({ provider: 'google', providerID: `place-${i}`, label: '', provenance: 'maps_export' }),
    }))
  }
  const first = await t.query(internal.privatePlaces.changes, { ownerAuthUserId, after: 0 })
  const last = await t.query(internal.privatePlaces.changes, { ownerAuthUserId, after: first.cursor })
  expect(first.hasMore).toBe(true)
  expect(last.hasMore).toBe(false)
  expect(new Set([...first.records, ...last.records].map(r => r.id)).size).toBe(105)
})

test('account deletion fences private operations and purges Lists, places and receipts', async () => {
  vi.useFakeTimers()
  const { t, ownerAuthUserId } = await setup()
  await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId))
  await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, { kind: 'list', id: 'list-one', payloadJSON: JSON.stringify({ name: 'Private' }) }))
  await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, { kind: 'membership', id: 'list-one|google:place-123', payloadJSON: JSON.stringify({ listID: 'list-one', placeID: 'google:place-123', order: 0 }) }))
  await t.mutation(internal.accountDeletion.prepare, { ownerAuthUserId })
  await expect(t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId))).rejects.toThrow('account')
  await t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: 'user', where: [{ field: '_id', value: ownerAuthUserId }] } })
  await t.mutation(internal.accountDeletion.activate, { ownerAuthUserId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  for (const table of ['savedPlaces', 'privatePlaceLists', 'privatePlaceMemberships', 'privatePlaceReceipts', 'privatePlaceVersions'] as const) {
    expect(await t.run(ctx => ctx.db.query(table).collect())).toHaveLength(0)
  }
})

test('provider metadata boundaries reject coordinates, unknown fields and unsafe links', () => {
  expect(() => parsePrivatePlacePayload('place', JSON.stringify({ provider: 'google', providerID: 'id', provenance: 'saved', latitude: 1, longitude: 2 }))).toThrow('Google coordinates')
  expect(() => parsePrivatePlacePayload('place', JSON.stringify({ provider: 'google', providerID: 'id', provenance: 'saved', formattedAddress: 'No' }))).toThrow('Unknown')
  expect(() => parsePrivatePlacePayload('place', JSON.stringify({ provider: 'unresolved', provenance: 'maps_import', sourceURL: 'javascript:alert(1)' }))).toThrow('source')
})

test('a deleted List produces a reviewable membership conflict without blocking other changes', async () => {
  const { t, ownerAuthUserId } = await setup()
  await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId))
  const listPayload = JSON.stringify({ name: 'Weekend' })
  const list = await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, { kind: 'list', id: 'weekend', payloadJSON: listPayload }))
  await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, { kind: 'list', id: 'weekend', payloadJSON: listPayload, expectedRevision: list.record!.revision, deleted: true }))
  const conflict = await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, {
    kind: 'membership', id: 'weekend|google:place-123', payloadJSON: JSON.stringify({ listID: 'weekend', placeID: 'google:place-123', order: 0 }),
  }))
  expect(conflict).toMatchObject({ conflict: true, record: { deleted: true } })
  expect(await t.mutation(internal.privatePlaces.push, operation(ownerAuthUserId, {
    kind: 'list', id: 'food', payloadJSON: JSON.stringify({ name: 'Food' }),
  }))).toMatchObject({ conflict: false })
})
