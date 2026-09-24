export type RoutePlaceInput =
  | { provider: 'google'; providerPlaceID: string }
  | { provider: 'apple' | 'manual'; latitude: number; longitude: number }

export type RouteStopInput = {
  localStopID: string
  orderIndex: number
  place: RoutePlaceInput
}

/** Prevent an in-flight calculation from saving against stops edited mid-request. */
export function isCurrentRouteRevision(pathRevision: number, calculatedRevision: number) {
  return pathRevision === calculatedRevision
}

export function validatePrivatePathRouteInput(input: {
  localPathID: string
  title: string
  stops: RouteStopInput[]
}): string | null {
  const localPathID = input.localPathID.trim()
  const title = input.title.trim()
  if (!localPathID || localPathID.length > 80 || !title || title.length > 160) {
    return 'That Path cannot be synced for routing.'
  }
  if (input.stops.length < 2 || input.stops.length > 25) {
    return 'Add 2–25 located stops before calculating a route.'
  }

  const stopIDs = new Set<string>()
  const orders = new Set<number>()
  for (const stop of input.stops) {
    const stopID = stop.localStopID.trim()
    if (!stopID || stopID.length > 80 || stopIDs.has(stopID) || orders.has(stop.orderIndex)) {
      return 'That Path contains duplicate or invalid stops.'
    }
    if (!Number.isInteger(stop.orderIndex) || stop.orderIndex < 0 || stop.orderIndex > 24) {
      return 'That Path has an invalid stop order.'
    }
    if (stop.place.provider === 'google') {
      const placeID = stop.place.providerPlaceID.trim()
      if (!placeID || placeID.length > 512) return 'Choose a Google place before calculating a route.'
    } else if (!Number.isFinite(stop.place.latitude) || !Number.isFinite(stop.place.longitude) ||
      stop.place.latitude < -90 || stop.place.latitude > 90 || stop.place.longitude < -180 || stop.place.longitude > 180) {
      return 'That Path contains an invalid place location.'
    }
    stopIDs.add(stopID)
    orders.add(stop.orderIndex)
  }
  return null
}
