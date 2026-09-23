import { describe, expect, it } from 'vitest'
import { leavesPendingState } from '../convex/recommendationStatusTransition'

describe('pending recommendation counter transitions', () => {
  it('decrements only when a pending recommendation leaves pending', () => {
    expect(leavesPendingState('pending', 'accepted')).toBe(true)
    expect(leavesPendingState('pending', 'ignored')).toBe(true)
  })

  it('does not decrement on repeated terminal-state updates or pending retries', () => {
    expect(leavesPendingState('accepted', 'accepted')).toBe(false)
    expect(leavesPendingState('ignored', 'ignored')).toBe(false)
    expect(leavesPendingState('pending', 'pending')).toBe(false)
  })
})
