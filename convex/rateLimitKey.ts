/** Derive a non-reversible edge bucket without persisting a raw client IP. */
export async function opaqueEdgeRateLimitKey(salt: string | undefined, ip: string | null, isProduction: boolean) {
  if (isProduction && (!salt || !ip)) {
    throw new Error('Production public ingress requires a rate-limit salt and edge IP.')
  }
  const keyMaterial = salt ?? 'local-development-only'
  const message = `public-ingress:${ip ?? 'local'}`
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(keyMaterial), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
