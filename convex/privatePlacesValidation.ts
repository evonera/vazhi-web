export type PrivatePlaceKind = 'place' | 'list' | 'membership'
export type PrivatePlacePayload = {
  provider?: 'google' | 'apple' | 'manual' | 'unresolved'
  providerID?: string; label?: string; note?: string; provenance?: string; categories?: string[]
  latitude?: number; longitude?: number; name?: string; summary?: string; icon?: string
  mapVisible?: boolean; listID?: string; placeID?: string; order?: number
  sourceURL?: string; createdAt?: number; updatedAt?: number
}

export function parsePrivatePlacePayload(kind: PrivatePlaceKind, raw: string): PrivatePlacePayload {
  if (raw.length > 12_000) throw new Error('Place data is too large.')
  const p: unknown = JSON.parse(raw)
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid place data.')
  const data = p as Record<string, unknown>
  const keys = kind === 'place' ? ['provider', 'providerID', 'label', 'note', 'provenance', 'categories', 'latitude', 'longitude', 'sourceURL']
    : kind === 'list' ? ['name', 'summary', 'icon', 'mapVisible'] : ['listID', 'placeID', 'order']
  keys.push('createdAt', 'updatedAt')
  if (Object.keys(data).some(k => !keys.includes(k))) throw new Error('Unknown place field.')
  for (const [key, value] of Object.entries(data)) {
    if (['latitude', 'longitude', 'order', 'createdAt', 'updatedAt'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid number.')
      if (['createdAt', 'updatedAt'].includes(key) && (value < 0 || value > 32_503_680_000)) throw new Error('Invalid timestamp.')
    } else if (key === 'categories') {
      if (!Array.isArray(value) || value.length > 20 || value.some(v => typeof v !== 'string' || v.length > 80)) throw new Error('Invalid categories.')
    } else if (key === 'mapVisible') {
      if (typeof value !== 'boolean') throw new Error('Invalid map visibility.')
    } else if (typeof value !== 'string' || value.length > (key === 'sourceURL' ? 2048 : key === 'note' || key === 'summary' ? 4000 : 400)) {
      throw new Error('Invalid text.')
    }
  }
  const text = (key: string) => typeof data[key] === 'string' && (data[key] as string).trim().length > 0
  if (kind === 'place') {
    if (data.sourceURL !== undefined) {
      const source = new URL(String(data.sourceURL))
      if (source.protocol !== 'https:' || source.username || source.password || !['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl'].includes(source.hostname)) throw new Error('Invalid source link.')
    }
    if (!['google', 'apple', 'manual', 'unresolved'].includes(String(data.provider)) || !text('provenance')) throw new Error('Invalid provider.')
    if (data.provider === 'google' && (!text('providerID') || data.latitude !== undefined || data.longitude !== undefined)) throw new Error('Google coordinates cannot be synced.')
    if ((data.latitude === undefined) !== (data.longitude === undefined) ||
        Math.abs(Number(data.latitude ?? 0)) > 90 || Math.abs(Number(data.longitude ?? 0)) > 180) throw new Error('Invalid coordinates.')
  } else if (kind === 'list' && !text('name')) throw new Error('A List needs a name.')
  else if (kind === 'membership' && (!text('listID') || !text('placeID') || !Number.isSafeInteger(data.order) || Number(data.order) < 0)) throw new Error('Invalid membership.')
  return data as PrivatePlacePayload
}

export function validatePrivatePlaceID(kind: PrivatePlaceKind, id: string, data: PrivatePlacePayload) {
  if (!id || id.length > 900 || /[\u0000-\u001f]/.test(id)) throw new Error('Invalid identifier.')
  if (kind === 'place' && data.provider === 'google' && id !== `google:${data.providerID}`) throw new Error('Place identity mismatch.')
  if (kind === 'membership' && id !== `${data.listID}|${data.placeID}`) throw new Error('Membership identity mismatch.')
}
