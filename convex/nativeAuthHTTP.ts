import type { HttpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal, components } from './_generated/api'
import { createAuth } from './betterAuth/auth'
import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter'

const limits = new RateLimiter(components.rateLimiter, {
  nativeAuthorize: { kind: 'token bucket', rate: 10, period: MINUTE, capacity: 10 },
  nativeExchange: { kind: 'token bucket', rate: 500, period: MINUTE, capacity: 500 },
})

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})
const base64URL = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const hash = async (value: string) => base64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
async function input(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 2048) throw new Error('Oversized request')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request')
  return value as Record<string, unknown>
}

export function registerNativeAuth(http: HttpRouter) {
  http.route({ path: '/api/native/authorize', method: 'POST', handler: httpAction(async (ctx, request) => {
    try {
      // Cookies only from our website, protected by a mandatory Origin check.
      if (!process.env.SITE_URL || request.headers.get('origin') !== new URL(process.env.SITE_URL).origin) return reply({}, 403)
      const body = await input(request)
      if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) return reply({}, 400)
      const session = await createAuth(ctx).api.getSession({ headers: request.headers })
      if (!session) return reply({ message: 'Sign in to continue.' }, 401)
      if (!(await limits.limit(ctx, 'nativeAuthorize', { key: session.user.id })).ok) return reply({ message: 'Please wait before trying again.' }, 429)
      // A valid, unexpired browser session may connect the phone at any time.
      // The short-lived, single-use code and PKCE verifier bound the handoff;
      // session creation time does not provide an additional security boundary.
      const code = base64URL(crypto.getRandomValues(new Uint8Array(32)))
      await ctx.runMutation(internal.nativeAuth.createGrant, {
        codeHash: await hash(code), codeChallenge: body.challenge,
        ownerAuthUserId: session.user.id, sessionToken: session.session.token,
      })
      return reply({ code })
    } catch { return reply({ message: 'Could not connect your iPhone. Try signing in again.' }, 400) }
  }) })
  http.route({ path: '/api/native/exchange', method: 'POST', handler: httpAction(async (ctx, request) => {
    try {
      const body = await input(request)
      if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.code) || typeof body.verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(body.verifier)) return reply({}, 400)
      // Global safety cap is additive to 256-bit unguessable codes and PKCE.
      // No untrusted forwarded IP or raw visitor address is persisted.
      if (!(await limits.limit(ctx, 'nativeExchange', { key: 'global' })).ok) return reply({ message: 'Please wait before trying again.' }, 429)
      const grant = await ctx.runMutation(internal.nativeAuth.consumeGrant, { codeHash: await hash(body.code), codeChallenge: await hash(body.verifier) })
      if (!grant) return reply({ message: 'Sign-in expired. Please try again.' }, 401)
      const headers = new Headers({ authorization: `Bearer ${grant.sessionToken}` })
      const auth = createAuth(ctx)
      const session = await auth.api.getSession({ headers })
      if (!session || session.user.id !== grant.ownerAuthUserId) return reply({}, 401)
      const { token } = await auth.api.getToken({ headers })
      return reply({ authUserID: session.user.id, convexAccessToken: token, authSessionToken: grant.sessionToken, email: session.user.email, name: session.user.name })
    } catch { return reply({ message: 'Could not complete sign-in. Try again.' }, 400) }
  }) })
}
