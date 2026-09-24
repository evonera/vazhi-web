import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { authComponent } from './betterAuth/auth'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import type { DataModel } from './_generated/dataModel'

const reservedHandles = new Set([
  'about', 'admin', 'api', 'ask', 'contact', 'download', 'help', 'inbox',
  'privacy', 'report', 'requests', 'settings', 'sign-in', 'studio', 'support',
  'terms', 'vazhi',
])

async function requireOwnerAuthUserId(ctx: GenericCtx<DataModel>) {
  return String((await authComponent.getAuthUser(ctx))._id)
}

function normalizedHandle(handle: string | undefined) {
  if (handle === undefined || handle.trim() === '') return undefined
  const value = handle.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,24}$/.test(value) || reservedHandles.has(value)) {
    throw new ConvexError('Choose a handle with 3–24 lowercase letters, numbers, or underscores.')
  }
  return value
}

const editable = {
  handle: v.optional(v.string()),
  displayName: v.optional(v.string()),
  bio: v.optional(v.string()),
  isPublic: v.boolean(),
}

/** Returns the authenticated owner's editable private profile state. */
export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    return ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q
      .eq('ownerAuthUserId', ownerAuthUserId)).unique()
  },
})

/** Claims or edits an opt-in profile without publishing any journal data. */
export const saveMine = mutation({
  args: editable,
  handler: async (ctx, args) => {
    const ownerAuthUserId = await requireOwnerAuthUserId(ctx)
    if (args.displayName && args.displayName.trim().length > 40) throw new ConvexError('Display name is too long.')
    if (args.bio && args.bio.trim().length > 160) throw new ConvexError('Bio is too long.')
    const handle = normalizedHandle(args.handle)
    const current = await ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q
      .eq('ownerAuthUserId', ownerAuthUserId)).unique()

    if (handle && handle !== current?.handle) {
      const claimed = await ctx.db.query('profiles').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      const aliased = await ctx.db.query('profileHandleAliases').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      if ((claimed && claimed.ownerAuthUserId !== ownerAuthUserId) || (aliased && aliased.ownerAuthUserId !== ownerAuthUserId)) {
        throw new ConvexError('That handle is unavailable.')
      }
    }

    const profile = {
      ownerAuthUserId,
      handle,
      displayName: args.displayName?.trim() || undefined,
      bio: args.bio?.trim() || undefined,
      isPublic: args.isPublic,
      updatedAt: Date.now(),
    }
    if (current) {
      if (current.handle && current.handle !== handle) {
        const existingAlias = await ctx.db.query('profileHandleAliases')
          .withIndex('by_handle', (q) => q.eq('handle', current.handle!))
          .unique()
        // A handle remains an alias for its original owner exactly once. This
        // also keeps `.unique()` lookup valid when they switch A → B → A → B.
        if (!existingAlias) {
          await ctx.db.insert('profileHandleAliases', { ownerAuthUserId, handle: current.handle, createdAt: Date.now() })
        }
      }
      await ctx.db.patch(current._id, profile)
      return current._id
    }
    return ctx.db.insert('profiles', profile)
  },
})

/** HTTP actions authenticate the session themselves and delegate only this
 * opaque owner ID; callers can never select an arbitrary profile. */
export const getForOwner = internalQuery({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q
    .eq('ownerAuthUserId', args.ownerAuthUserId)).unique(),
})

export const saveForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), ...editable },
  handler: async (ctx, args) => {
    if (args.displayName && args.displayName.trim().length > 40) throw new ConvexError('Display name is too long.')
    if (args.bio && args.bio.trim().length > 160) throw new ConvexError('Bio is too long.')
    const handle = normalizedHandle(args.handle)
    const current = await ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q
      .eq('ownerAuthUserId', args.ownerAuthUserId)).unique()
    if (handle && handle !== current?.handle) {
      const claimed = await ctx.db.query('profiles').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      const aliased = await ctx.db.query('profileHandleAliases').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      if ((claimed && claimed.ownerAuthUserId !== args.ownerAuthUserId) || (aliased && aliased.ownerAuthUserId !== args.ownerAuthUserId)) throw new ConvexError('That handle is unavailable.')
    }
    const profile = { ownerAuthUserId: args.ownerAuthUserId, handle, displayName: args.displayName?.trim() || undefined, bio: args.bio?.trim() || undefined, isPublic: args.isPublic, updatedAt: Date.now() }
    if (current) {
      if (current.handle && current.handle !== handle) {
        const alias = await ctx.db.query('profileHandleAliases').withIndex('by_handle', (q) => q.eq('handle', current.handle!)).unique()
        if (!alias) await ctx.db.insert('profileHandleAliases', { ownerAuthUserId: args.ownerAuthUserId, handle: current.handle, createdAt: Date.now() })
      }
      await ctx.db.patch(current._id, profile)
      return current._id
    }
    return ctx.db.insert('profiles', profile)
  },
})

/** Sanitised lookup for later public profile routes. */
export const getPublicByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const handle = normalizedHandle(args.handle)
    if (!handle) return null
    let profile = await ctx.db.query('profiles').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
    if (!profile) {
      const alias = await ctx.db.query('profileHandleAliases').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
      if (alias) profile = await ctx.db.query('profiles').withIndex('by_ownerAuthUserId', (q) => q.eq('ownerAuthUserId', alias.ownerAuthUserId)).unique()
    }
    if (!profile || !profile.isPublic || !profile.handle) return null
    return { handle: profile.handle, displayName: profile.displayName, bio: profile.bio }
  },
})
