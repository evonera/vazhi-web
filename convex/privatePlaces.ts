import { v, ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { accountMayAcceptWork, accountDeletionRequested } from './accountDeletion'
import { parsePrivatePlacePayload, validatePrivatePlaceID, type PrivatePlaceKind } from './privatePlacesValidation'

const kind = v.union(v.literal('place'), v.literal('list'), v.literal('membership'))
const tables = { place: 'savedPlaces', list: 'privatePlaceLists', membership: 'privatePlaceMemberships' } as const
export const push = internalMutation({
  args: { ownerAuthUserId: v.string(), operationID: v.string(), kind, id: v.string(),
    expectedRevision: v.number(), payloadJSON: v.string(), deleted: v.boolean() },
  handler: async (ctx, args) => {
    const owner = args.ownerAuthUserId
    if (!await accountMayAcceptWork(ctx, owner)) throw new ConvexError('This account is unavailable.')
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.operationID) || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new ConvexError('Invalid operation.')
    const receipt = await ctx.db.query('privatePlaceReceipts').withIndex('by_owner_and_operation', q => q.eq('ownerAuthUserId', owner).eq('operationID', args.operationID)).unique()
    if (receipt) return JSON.parse(receipt.resultJSON)
    const data = parsePrivatePlacePayload(args.kind, args.payloadJSON)
    validatePrivatePlaceID(args.kind, args.id, data)
    const table = tables[args.kind]
    const current = await ctx.db.query(table).withIndex('by_owner_and_id', q => q.eq('ownerAuthUserId', owner).eq('localID', args.id)).unique()
    if ((current?.revision ?? 0) !== args.expectedRevision) {
      return { conflict: true, record: current ? { kind: args.kind, id: current.localID, revision: current.revision, payloadJSON: current.payloadJSON, deleted: current.deleted } : null }
    }
    if (args.kind === 'membership' && !args.deleted) {
      const list = await ctx.db.query('privatePlaceLists').withIndex('by_owner_and_id', q => q.eq('ownerAuthUserId', owner).eq('localID', data.listID!)).unique()
      const place = await ctx.db.query('savedPlaces').withIndex('by_owner_and_id', q => q.eq('ownerAuthUserId', owner).eq('localID', data.placeID!)).unique()
      if (!list || list.deleted || !place || place.deleted) {
        // A deleted dependency is reviewable, not a transport failure that
        // blocks every later operation and the delta pull on an offline device.
        return { conflict: true, record: { kind: args.kind, id: args.id,
          revision: current?.revision ?? 0, payloadJSON: args.payloadJSON, deleted: true } }
      }
    }
    const counter = await ctx.db.query('privatePlaceVersions').withIndex('by_ownerAuthUserId', q => q.eq('ownerAuthUserId', owner)).unique()
    const revision = (counter?.revision ?? 0) + 1
    if (counter) await ctx.db.patch(counter._id, { revision })
    else await ctx.db.insert('privatePlaceVersions', { ownerAuthUserId: owner, revision })
    const record = { ownerAuthUserId: owner, localID: args.id, revision, payloadJSON: args.payloadJSON, deleted: args.deleted, updatedAt: Date.now() }
    if (current) await ctx.db.replace(current._id, record)
    else await ctx.db.insert(table, record)
    const result = { conflict: false, record: { kind: args.kind, id: args.id, revision, payloadJSON: args.payloadJSON, deleted: args.deleted } }
    await ctx.db.insert('privatePlaceReceipts', { ownerAuthUserId: owner, operationID: args.operationID, resultJSON: JSON.stringify(result) })
    return result
  },
})

export const changes = internalQuery({
  args: { ownerAuthUserId: v.string(), after: v.number() },
  handler: async (ctx, { ownerAuthUserId: owner, after }) => {
    if (await accountDeletionRequested(ctx, owner)) throw new ConvexError('This account is unavailable.')
    if (!Number.isSafeInteger(after) || after < 0) throw new ConvexError('Invalid cursor.')
    const groups = await Promise.all((Object.keys(tables) as PrivatePlaceKind[]).map(async kind => {
      const rows = await ctx.db.query(tables[kind]).withIndex('by_owner_and_revision', q => q.eq('ownerAuthUserId', owner).gt('revision', after)).take(101)
      return rows.map(r => ({ kind, id: r.localID, revision: r.revision, payloadJSON: r.payloadJSON, deleted: r.deleted }))
    }))
    const records = groups.flat().sort((a, b) => a.revision - b.revision).slice(0, 100)
    return { records, cursor: records.at(-1)?.revision ?? after, hasMore: groups.flat().length > 100 }
  },
})
