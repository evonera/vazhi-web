export type RevenueCatEventProjection = {
  eventID: string
  eventType: string
  occurredAt: number
  appUserID?: string
  environment?: string
  store?: string
  entitlementIDs: string[]
}

const maximumEventIDLength = 256
const maximumStringLength = 256

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function boundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumStringLength
    ? value
    : undefined
}

/**
 * Extract only the stable fields Vazhi needs from a RevenueCat event. The raw
 * payload can include subscriber attributes, price, country, and transaction
 * data, so it is deliberately never returned for persistence or logging.
 */
export function parseRevenueCatWebhook(rawBody: string): RevenueCatEventProjection | undefined {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return undefined
  }

  const root = record(body)
  const event = record(root?.event)
  if (!root || !event || !boundedString(root.api_version)) return undefined

  const eventID = boundedString(event.id)
  const eventType = boundedString(event.type)
  const occurredAt = event.event_timestamp_ms
  if (!eventID || eventID.length > maximumEventIDLength || !eventType || typeof occurredAt !== 'number' || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    return undefined
  }

  const entitlementIDs = Array.isArray(event.entitlement_ids)
    ? [...new Set(event.entitlement_ids.filter((entry): entry is string => Boolean(boundedString(entry))))]
    : []

  return {
    eventID,
    eventType,
    occurredAt,
    appUserID: boundedString(event.app_user_id),
    environment: boundedString(event.environment),
    store: boundedString(event.store),
    entitlementIDs,
  }
}

function parseSignatureHeader(value: string | null): { timestamp: number, signature: Uint8Array } | undefined {
  if (!value) return undefined
  const parts = new Map<string, string>()
  for (const part of value.split(',')) {
    const separator = part.indexOf('=')
    if (separator <= 0) return undefined
    const key = part.slice(0, separator).trim()
    const partValue = part.slice(separator + 1).trim()
    if (!key || !partValue || parts.has(key)) return undefined
    parts.set(key, partValue)
  }
  const timestamp = Number(parts.get('t'))
  const encodedSignature = parts.get('v1')
  if (!Number.isSafeInteger(timestamp) || !encodedSignature || !/^[a-f0-9]{64}$/i.test(encodedSignature)) return undefined

  const signature = new Uint8Array(encodedSignature.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [])
  return signature.byteLength === 32 ? { timestamp, signature } : undefined
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

/**
 * RevenueCat's HMAC covers the exact raw JSON bytes, prefixed by its delivery
 * timestamp. Do not parse/re-serialize the body before this check.
 */
export async function verifyRevenueCatWebhookSignature({
  rawBody,
  signatureHeader,
  signingSecret,
  nowSeconds = Math.floor(Date.now() / 1_000),
  toleranceSeconds = 300,
}: {
  rawBody: string
  signatureHeader: string | null
  signingSecret: string
  nowSeconds?: number
  toleranceSeconds?: number
}): Promise<boolean> {
  const parsed = parseSignatureHeader(signatureHeader)
  if (!parsed || !signingSecret || Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parsed.timestamp}.${rawBody}`))
  return constantTimeEqual(new Uint8Array(signed), parsed.signature)
}
