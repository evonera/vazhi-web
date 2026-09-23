import { describe, expect, it } from 'vitest'
import { ownerMayTransitionListingStatus, reportHasActiveTakedown } from '../convex/moderationPolicy'
import { acceptPublicReport } from '../convex/publicReportReceipt'
import { parseModerationPagination } from '../convex/moderationPagination'

describe('moderation policy', () => {
  it('bounds each moderation queue page and keeps independent cursors', () => {
    const pagination = parseModerationPagination(new URL('https://vazhi.app/api/admin/reports?limit=500&openCursor=open-next&takedownCursor=taken-next'))
    expect(pagination).toEqual({
      openReportsPagination: { numItems: 100, cursor: 'open-next' },
      takedownListingsPagination: { numItems: 100, cursor: 'taken-next' },
    })
  })

  it('uses a safe default page size and ignores oversized cursors', () => {
    const pagination = parseModerationPagination(new URL(`https://vazhi.app/api/admin/reports?openCursor=${'x'.repeat(2001)}`))
    expect(pagination.openReportsPagination).toEqual({ numItems: 25, cursor: null })
    expect(pagination.takedownListingsPagination).toEqual({ numItems: 25, cursor: null })
  })

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
