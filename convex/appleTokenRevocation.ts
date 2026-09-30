import { apple } from '@better-auth/core/social-providers'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import type { GenericActionCtx } from 'convex/server'
import type { DataModel } from './_generated/dataModel'
import { internal } from './_generated/api'

/** Native client secrets must be created for the bundle ID, not the web ID. */
export function nativeAppleTokenConfiguration() {
  const clientID = process.env.APPLE_BUNDLE_ID
  const clientSecret = process.env.APPLE_NATIVE_CLIENT_SECRET
  const encryptionKey = process.env.BETTER_AUTH_SECRET
  return clientID && clientSecret && encryptionKey ? { clientID, clientSecret, encryptionKey } : null
}

export async function verifiedAppleSubject(identityToken: string, clientID: string) {
  const provider = apple({ clientId: clientID, clientSecret: '', appBundleIdentifier: clientID })
  // Better Auth verifies the Apple JWKS signature, issuer, audience and expiry.
  // Read the subject only AFTER that verification; decoding alone is not proof.
  if (!await provider.verifyIdToken(identityToken)) return null
  const info = await provider.getUserInfo({ idToken: identityToken })
  return typeof info?.user.id === 'string' && info.user.id ? info.user.id : null
}

export async function exchangeAppleAuthorizationCode(authorizationCode: string, identityToken: string) {
  const config = nativeAppleTokenConfiguration()
  if (!config) return null
  const subject = await verifiedAppleSubject(identityToken, config.clientID)
  if (!subject) return null
  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientID, client_secret: config.clientSecret,
      code: authorizationCode, grant_type: 'authorization_code',
    }), redirect: 'error', signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) return null
  const tokens: unknown = await response.json()
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null
  const value = tokens as Record<string, unknown>
  if (typeof value.id_token !== 'string' || typeof value.refresh_token !== 'string' ||
      !value.refresh_token || value.refresh_token.length > 8_192 ||
      await verifiedAppleSubject(value.id_token, config.clientID) !== subject) return null
  return {
    appleSubject: subject, clientID: config.clientID,
    encryptedRefreshToken: await symmetricEncrypt({ key: config.encryptionKey, data: value.refresh_token }),
  }
}

/** Deletion still proceeds for legacy accounts/network failures; UI explains manual revocation. */
export async function revokeAppleCredentialForDeletion(ctx: GenericActionCtx<DataModel>, ownerAuthUserId: string) {
  try {
    const record = await ctx.runQuery(internal.appleCredentials.forDeletion, { ownerAuthUserId })
    if (!record) return false
    const config = nativeAppleTokenConfiguration()
    if (!config || config.clientID !== record.clientID) return false
    const token = await symmetricDecrypt({ key: config.encryptionKey, data: record.encryptedRefreshToken })
    const response = await fetch('https://appleid.apple.com/auth/revoke', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: record.clientID, client_secret: config.clientSecret,
        token, token_type_hint: 'refresh_token',
      }), redirect: 'error', signal: AbortSignal.timeout(8_000),
    })
    return response.ok
  } catch {
    return false
  }
}
