import { describe, expect, it } from 'vitest'
import { ownerMayTransitionListingStatus, reportHasActiveTakedown } from '../convex/moderationPolicy'
import { acceptPublicReport } from '../convex/publicReportReceipt'

describe('moderation policy', () => {
  it('allows new and archived listings but does not let owners reverse moderator takedowns', () => {
    expect(ownerMayTransitionListingStatus(undefined)).toBe(true)
    expect(ownerMayTransitionListingStatus('published')).toBe(true)
    expect(ownerMayTransitionListingStatus('archived')).toBe(true)
    expect(ownerMayTransitionListingStatus('takedown')).toBe(false)
  })

  it('allows restoration only while the report’s latest moderation action is its takedown', () => {
    expect(reportHasActiveTakedown([{ action: 'takedown', previousListingStatus: 'published' }])).toBe(true)
    expect(reportHasActiveTakedown([
      { action: 'restore', previousListingStatus: 'published' },
      { action: 'takedown', previousListingStatus: 'published' },
    ])).toBe(false)
    expect(reportHasActiveTakedown([
      { action: 'takedown', previousListingStatus: 'archived' },
      { action: 'restore', previousListingStatus: 'published' },
    ])).toBe(true)
    expect(reportHasActiveTakedown([{ action: 'dismiss' }])).toBe(false)
  })

  it('returns the generic receipt when the public report body is malformed', async () => {
    let submitted = false
    const receipt = await acceptPublicReport(
      new Request('https://vazhi.app/api/reports', { method: 'POST', body: '{' }),
      async () => { submitted = true },
    )

    expect(receipt).toEqual({ accepted: true })
    expect(submitted).toBe(false)
  })

  it('returns the generic receipt when report persistence rejects the submission', async () => {
    const receipt = await acceptPublicReport(
      new Request('https://vazhi.app/api/reports', { method: 'POST', body: JSON.stringify({ listingSlug: 'guide' }) }),
      async () => { throw new Error('rate limited') },
    )

    expect(receipt).toEqual({ accepted: true })
  })
})
