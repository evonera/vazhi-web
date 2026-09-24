const replayWindowSeconds = 5 * 60

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function digest(rawBody: string, signingSecret: string, timestamp: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))
}

/** Sign an edge-verified public write without putting the secret in a client. */
export async function edgeIngressSignature(
  rawBody: string,
  signingSecret: string,
  timestamp = Math.floor(Date.now() / 1_000),
) {
  return `t=${timestamp},v1=${await digest(rawBody, signingSecret, timestamp)}`
}

/** Reject malformed, replayed, and non-authentic public ingress requests. */
export async function verifyEdgeIngressSignature({
  rawBody,
  signatureHeader,
  signingSecret,
  nowSeconds = Math.floor(Date.now() / 1_000),
}: {
  rawBody: string
  signatureHeader: string | null
  signingSecret: string
  nowSeconds?: number
}) {
  const timestamp = signatureHeader?.match(/(?:^|,)t=(\d+)(?:,|$)/)?.[1]
  const signature = signatureHeader?.match(/(?:^|,)v1=([a-f0-9]+)(?:,|$)/i)?.[1]
  if (!timestamp || !signature) return false
  const issuedAt = Number(timestamp)
  if (!Number.isSafeInteger(issuedAt) || Math.abs(nowSeconds - issuedAt) > replayWindowSeconds) return false
  return constantTimeEqual(await digest(rawBody, signingSecret, issuedAt), signature)
}
