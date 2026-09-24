import { ConvexError, v } from 'convex/values'
import { DAY, HOUR, RateLimiter } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'
import { internalMutation } from './_generated/server'

const rateLimiter = new RateLimiter(components.rateLimiter, {
  ownerPlaceSearchHourly: { kind: 'token bucket', rate: 120, period: HOUR, capacity: 120 },
  ownerPlaceSearchDaily: { kind: 'token bucket', rate: 300, period: DAY, capacity: 300 },
})

/** Consume both quotas before a billable Google request. The key is the verified owner ID. */
export const consumeOwnerSearch = internalMutation({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => {
    const hourly = await rateLimiter.limit(ctx, 'ownerPlaceSearchHourly', { key: args.ownerAuthUserId })
    const daily = await rateLimiter.limit(ctx, 'ownerPlaceSearchDaily', { key: args.ownerAuthUserId })
    if (!hourly.ok || !daily.ok) throw new ConvexError('Place search limit reached. Try again later.')
    return null
  },
})
