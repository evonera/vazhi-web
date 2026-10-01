const encoder = new TextEncoder()
const tokenVersion = 'v1'
const tokenPattern = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/i

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return mismatch === 0
}

/** A signed, opaque browser identity. It is pseudonymous, not an account identity. */
export async function makeContributorCookie(secret: string, id = crypto.randomUUID()): Promise<string> {
  if (!secret) throw new Error('Contributor signing secret is unavailable.')
  return `${tokenVersion}.${id}.${await sign(`${tokenVersion}.${id}`, secret)}`
}

export async function readContributorCookie(value: string | null, secret: string): Promise<string | null> {
  if (!value || !secret) return null
  const token = value.startsWith(`${tokenVersion}.`) ? value.slice(tokenVersion.length + 1) : ''
  const match = token.match(tokenPattern)
  if (!match) return null
  const expected = await sign(`${tokenVersion}.${match[1]}`, secret)
  return equal(match[2].toLowerCase(), expected) ? match[1].toLowerCase() : null
}

export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try { return decodeURIComponent(part.slice(separator + 1).trim()) } catch { return null }
  }
  return null
}
