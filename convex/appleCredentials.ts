import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { components } from './_generated/api'
import { accountMayAcceptWork } from './accountDeletion'

export const save = internalMutation({
  args: {
    ownerAuthUserId: v.string(), appleSubject: v.string(), clientID: v.string(),
    encryptedRefreshToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!await accountMayAcceptWork(ctx, args.ownerAuthUserId)) return false
    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'account', where: [
        { field: 'userId', value: args.ownerAuthUserId },
        { field: 'providerId', value: 'apple' },
        { field: 'accountId', value: args.appleSubject },
      ],
    })
    if (!account) return false
    const existing = await ctx.db.query('appleRevocationCredentials')
      .withIndex('by_ownerAuthUserId', q => q.eq('ownerAuthUserId', args.ownerAuthUserId)).unique()
    const record = { ...args, updatedAt: Date.now() }
    if (existing) await ctx.db.replace(existing._id, record)
    else await ctx.db.insert('appleRevocationCredentials', record)
    return true
  },
})

export const forDeletion = internalQuery({
  args: { ownerAuthUserId: v.string() },
  returns: v.union(v.null(), v.object({
    _id: v.id('appleRevocationCredentials'), _creationTime: v.number(),
    ownerAuthUserId: v.string(), appleSubject: v.string(), clientID: v.string(),
    encryptedRefreshToken: v.string(), updatedAt: v.number(),
  })),
  handler: async (ctx, args) => ctx.db.query('appleRevocationCredentials')
    .withIndex('by_ownerAuthUserId', q => q.eq('ownerAuthUserId', args.ownerAuthUserId)).unique(),
})
