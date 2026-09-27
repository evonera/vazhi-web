import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'

export const createGrant = internalMutation({
  args: { codeHash: v.string(), codeChallenge: v.string(), ownerAuthUserId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('nativeAuthGrants', { ...args, expiresAt: Date.now() + 90_000 })
    await ctx.scheduler.runAfter(90_000, internal.nativeAuth.expireGrant, { id })
  },
})

export const expireGrant = internalMutation({
  args: { id: v.id('nativeAuthGrants') },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id)
  },
})

// Atomic consume: replay and concurrent exchanges cannot both succeed.
export const consumeGrant = internalMutation({
  args: { codeHash: v.string(), codeChallenge: v.string() },
  handler: async (ctx, args) => {
    const grant = await ctx.db.query('nativeAuthGrants').withIndex('by_codeHash', q => q.eq('codeHash', args.codeHash)).unique()
    if (!grant) return null
    if (grant.expiresAt <= Date.now()) {
      await ctx.db.delete(grant._id)
      return null
    }
    if (grant.codeChallenge !== args.codeChallenge) return null
    await ctx.db.delete(grant._id)
    return { ownerAuthUserId: grant.ownerAuthUserId, sessionToken: grant.sessionToken }
  },
})
