type SyncJobForValidation = {
  jobId?: string
  createdAt?: string
  journeyId?: string
  actionType: 'upsertJourney' | 'createMoment'
  journey?: { id: string; updatedAt?: string }
  moment?: { id?: string; journeyId: string }
}

/** Validate all cross-record constraints before the Convex mutation writes. */
export function getOutboxJobValidationError(item: SyncJobForValidation): string | null {
  if (!item.jobId?.trim()) return 'A non-empty outbox job ID is required.'
  if (!item.createdAt || !Number.isFinite(Date.parse(item.createdAt))) return 'A valid outbox creation time is required.'
  if (!item.journey) return 'A Journey snapshot is required for sync.'
  if (!item.journey.id.trim()) return 'A non-empty Journey ID is required.'
  if (!item.journey.updatedAt || !Number.isFinite(Date.parse(item.journey.updatedAt))) {
    return 'A valid Journey snapshot update time is required.'
  }
  if (item.journeyId !== undefined && item.journeyId !== item.journey.id) {
    return 'Outbox Journey ID must match its Journey snapshot.'
  }
  if (item.actionType === 'createMoment' && !item.moment) {
    return 'A Moment snapshot is required for a Moment sync.'
  }
  if (item.moment && (!item.moment.id?.trim() || !item.moment.journeyId.trim() || item.moment.journeyId !== item.journey.id)) {
    return 'Moment must belong to its synced Journey.'
  }
  return null
}

/**
 * Compare source versions, not server arrival time: retries and concurrent
 * devices can deliver an older snapshot after a newer one. The outbox creation
 * time breaks ties when the source's Date precision is the same.
 */
export function isSnapshotNewer(
  incomingUpdatedAt: string,
  incomingJobCreatedAt: string,
  currentUpdatedAt?: string,
  currentJobCreatedAt?: string,
): boolean {
  const incomingVersion = Date.parse(incomingUpdatedAt)
  const incomingJobVersion = Date.parse(incomingJobCreatedAt)
  if (!Number.isFinite(incomingVersion) || !Number.isFinite(incomingJobVersion)) return false

  const currentVersion = currentUpdatedAt ? Date.parse(currentUpdatedAt) : Number.NaN
  if (!Number.isFinite(currentVersion)) return true
  if (incomingVersion !== currentVersion) return incomingVersion > currentVersion

  const currentJobVersion = currentJobCreatedAt ? Date.parse(currentJobCreatedAt) : Number.NaN
  return !Number.isFinite(currentJobVersion) || incomingJobVersion > currentJobVersion
}
