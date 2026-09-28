import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

test('Google detail purge removes only retained Google fields, not manual pins', async () => {
  const t = convexTest(schema, modules)
  const googleID = await t.run(ctx => ctx.db.insert('syncedMoments', {
    ownerAuthUserId: 'owner', localMomentId: 'google', localJourneyId: 'journey',
    capturedAt: '2026-09-29T00:00:00Z', note: '', syncState: 'synced',
    placeSource: 'google', placeProviderID: 'google-place-id',
    latitude: 13.08, longitude: 80.27, placeName: 'Marina Beach',
    locality: 'Chennai', country: 'India', formattedAddress: 'Chennai, India',
    placePrimaryType: 'tourist_attraction', assetKinds: [], updatedAt: 1,
  }))
  const manualID = await t.run(ctx => ctx.db.insert('syncedMoments', {
    ownerAuthUserId: 'owner', localMomentId: 'manual', localJourneyId: 'journey',
    capturedAt: '2026-09-29T00:00:00Z', note: '', syncState: 'synced',
    placeSource: 'manual', latitude: 13.08, longitude: 80.27,
    placeName: 'My beach pin', assetKinds: [], updatedAt: 1,
  }))

  const result = await t.mutation(internal.sync.purgeGooglePlaceDetails, {
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(result).toEqual({ purged: 1, isDone: true })
  const [google, manual] = await t.run(ctx => Promise.all([
    ctx.db.get(googleID), ctx.db.get(manualID),
  ]))
  expect(google).toMatchObject({ placeSource: 'google', placeProviderID: 'google-place-id' })
  expect(google?.placeName).toBeUndefined()
  expect(google?.latitude).toBeUndefined()
  expect(google?.formattedAddress).toBeUndefined()
  expect(manual).toMatchObject({ placeSource: 'manual', placeName: 'My beach pin', latitude: 13.08 })
})
