import { describe, expect, it } from 'vitest'
import { matchesModeratorToken } from '../convex/moderationAuth'

describe('moderation API credential boundary', () => {
  it('accepts only the exact configured bearer value', () => {
    expect(matchesModeratorToken('only-for-operators', 'only-for-operators')).toBe(true)
    expect(matchesModeratorToken('only-for-operators ', 'only-for-operators')).toBe(false)
    expect(matchesModeratorToken('wrong', 'only-for-operators')).toBe(false)
    expect(matchesModeratorToken(null, 'only-for-operators')).toBe(false)
    expect(matchesModeratorToken('only-for-operators', undefined)).toBe(false)
  })
})
