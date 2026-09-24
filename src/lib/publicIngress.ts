/** Production and preview public ingress fails closed when secrets are absent. */
export function developmentIngressSalt(
  environment: string | undefined,
  configuredSalt: string | undefined,
): string | undefined {
  if (configuredSalt) return configuredSalt
  return environment === 'development' ? 'development-only' : undefined
}

export function mayBypassTurnstile(
  environment: string | undefined,
  configuredSecret: string | undefined,
): boolean {
  return !configuredSecret && environment === 'development'
}

/** A stable per-edge-client key that never persists or forwards the raw IP. */
export async function opaqueRateLimitKey(remoteIP: string | null, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(remoteIP ?? 'unknown'),
  )
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
