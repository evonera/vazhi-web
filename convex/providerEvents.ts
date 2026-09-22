import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

/**
 * An intentionally minimal, idempotent receipt of an already verified
 * RevenueCat webhook. The client never reads this table, and it never grants
 * Pro access: Purchases CustomerInfo remains the native entitlement truth.
 */
export const recordRevenueCat = internalMutation({
  args: {
    eventID: v.string(),
    eventType: v.string(),
    occurredAt: v.number(),
    appUserID: v.optional(v.string()),
    environment: v.optional(v.string()),
    store: v.optional(v.string()),
    entitlementIDs: v.array(v.string()),
  },
  handler: async (ctx, event) => {
    const existing = await ctx.db.query('providerEvents')
      .withIndex('by_source_and_eventID', (query) => query.eq('source', 'revenuecat').eq('eventID', event.eventID))
      .unique()
    if (existing) return { duplicate: true, id: existing._id }

    const id = await ctx.db.insert('providerEvents', {
      source: 'revenuecat',
      ...event,
      receivedAt: Date.now(),
    })
    return { duplicate: false, id }
  },
})
