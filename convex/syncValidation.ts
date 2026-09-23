type SyncJobForValidation = {
  actionType: 'upsertJourney' | 'createMoment'
  journey?: { id: string }
  moment?: { journeyId: string }
}

/** Validate all cross-record constraints before the Convex mutation writes. */
export function getOutboxJobValidationError(item: SyncJobForValidation): string | null {
  if (!item.journey) return 'A Journey snapshot is required for sync.'
  if (item.actionType === 'createMoment' && (!item.moment || item.moment.journeyId !== item.journey.id)) {
    return 'Moment must belong to its synced Journey.'
  }
  return null
}
