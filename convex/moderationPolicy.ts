type ListingStatus = 'published' | 'archived' | 'takedown'
type ModerationActionType = 'dismiss' | 'takedown' | 'restore'

export type ModerationActionSummary = {
  action: ModerationActionType
  previousListingStatus?: ListingStatus
}

/** Owners may change normal publication state, but only moderation may clear a takedown. */
export function ownerMayTransitionListingStatus(status: ListingStatus | undefined) {
  return status !== 'takedown'
}

/** The newest action for one report determines whether its takedown is active. */
export function reportHasActiveTakedown(actionsNewestFirst: ModerationActionSummary[]) {
  return actionsNewestFirst[0]?.action === 'takedown'
}

/** An unrelated report's dismissal must not shadow an earlier takedown. */
export function latestTakedownReportId<T extends { action: ModerationActionType; reportId: string }>(
  listingActionsNewestFirst: T[],
) {
  return listingActionsNewestFirst.find((action) => action.action === 'takedown')?.reportId
}

/** A reporter may retry after a prior report is resolved; only open reports coalesce. */
export function isDuplicateOpenReport(status: 'open' | 'reviewed' | 'dismissed' | undefined) {
  return status === 'open'
}
