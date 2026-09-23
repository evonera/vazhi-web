import type { Place } from './contracts'

export function manualPlace(name: string, latitudeText: string, longitudeText: string): Place | null {
  const title = name.trim()
  const latitudeInput = latitudeText.trim()
  const longitudeInput = longitudeText.trim()
  if (!title || title.length > 120 || !latitudeInput || !longitudeInput) return null
  const decimal = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/
  if (!decimal.test(latitudeInput) || !decimal.test(longitudeInput)) return null

  const latitude = Number(latitudeInput)
  const longitude = Number(longitudeInput)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  return { provider: 'manual', name: title, latitude, longitude }
}
