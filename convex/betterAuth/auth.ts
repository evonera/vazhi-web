import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import type { GenericActionCtx } from 'convex/server'
import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { components } from '../_generated/api'
import type { DataModel } from '../_generated/dataModel'
import authConfig from '../auth.config'
import schema from './schema'
import { internal } from '../_generated/api'
import { authCapabilities, deliverAuthEmail } from './configuration'
import { RateLimiter } from '@convex-dev/rate-limiter'

const authLimiter = new RateLimiter(components.rateLimiter, {})

export const authComponent = createClient<DataModel, typeof schema>(components.betterAuth, {
  local: { schema },
})

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth({
  appName: 'Vazhi',
  // Browser cookies and OAuth callbacks belong to the same-origin Worker.
  // Convex still issues its JWT with the Convex site's issuer.
  baseURL: process.env.SITE_URL ?? process.env.CONVEX_SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.SITE_URL ?? 'http://localhost:5173', 'https://appleid.apple.com'],
  // Do not trust caller-controlled forwarded-IP headers at the public Convex
  // origin. Until signed edge identity is available, use conservative shared
  // endpoint buckets; never persist a visitor's raw IP address.
  // Keep CSRF/origin checks active in tests as well as production.
  advanced: { disableOriginCheck: false, ipAddress: { ipAddressHeaders: [] } },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 20 },
      '/sign-up/email': { window: 60, max: 10 },
      '/request-password-reset': { window: 60, max: 10 },
      '/send-verification-email': { window: 60, max: 10 },
    },
    customStorage: {
      // Better Auth 1.6.33 calls consume atomically. Fail closed if an upgrade
      // unexpectedly falls back to the old non-atomic get/set contract.
      get: async () => { throw new Error('Atomic auth rate-limit storage required.') },
      set: async () => { throw new Error('Atomic auth rate-limit storage required.') },
      consume: async (key, rule) => {
        // Request handlers are actions. A read-only query must never attempt
        // to consume quota or silently fall back to a process-local counter.
        if (!('runMutation' in ctx)) throw new Error('Auth rate limiting requires a writable context.')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
        const opaqueKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        const result = await authLimiter.limit(ctx, `auth:${rule.window}:${rule.max}`, {
          key: opaqueKey,
          config: { kind: 'token bucket', rate: rule.max, period: rule.window * 1000, capacity: rule.max },
        })
        return { allowed: result.ok, retryAfter: result.ok ? null : Math.max(1, Math.ceil((result.retryAfter ?? rule.window * 1000) / 1000)) }
      },
    },
  },
  database: authComponent.adapter(ctx),
  emailAndPassword: {
    enabled: authCapabilities().email,
    requireEmailVerification: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await deliverAuthEmail(user.email, 'Reset your Vazhi password', `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      await deliverAuthEmail(user.email, 'Verify your Vazhi email', `Verify your email: ${url}\n\nOnly verify this address if you created a Vazhi account.`)
    },
  },
  account: {
    accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true },
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await (ctx as GenericActionCtx<DataModel>).runMutation(internal.accountDeletion.prepare, {
          ownerAuthUserId: user.id,
        })
      },
      afterDelete: async (user) => {
        try {
          await (ctx as GenericActionCtx<DataModel>).runMutation(internal.accountDeletion.activate, {
            ownerAuthUserId: user.id,
          })
        } catch (error) {
          // Better Auth has already removed the account. The durable recovery
          // scheduled by prepare activates cleanup once the user row is gone.
          console.error('Account deletion activation will be retried by recovery.', error)
        }
      },
    },
  },
  socialProviders: {
    // Retain native Apple token verification even before the web service ID
    // is provisioned. The public capability endpoint hides web Apple then.
    apple: {
      clientId: process.env.APPLE_SERVICE_ID ?? '',
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
      appBundleIdentifier: process.env.APPLE_BUNDLE_ID,
      // Apple can omit the email claim after the first authorization. Recover
      // it only from the user already linked to this verified Apple subject;
      // never accept an unverified email supplied by the native request.
      mapProfileToUser: async (profile) => {
        if (profile.email || !profile.sub) return {}
        const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'account',
          where: [
            { field: 'accountId', value: profile.sub },
            { field: 'providerId', value: 'apple' },
          ],
        })
        if (typeof account?.userId !== 'string') return {}
        const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'user',
          where: [{ field: '_id', value: account.userId }],
        })
        return typeof user?.email === 'string' && user.email
          ? { email: user.email, emailVerified: user.emailVerified === true }
          : {}
      },
    },
    ...(authCapabilities().google ? { google: {
      clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    } } : {}),
    ...(authCapabilities().discord ? { discord: {
      clientId: process.env.DISCORD_CLIENT_ID!, clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    } } : {}),
  },
  plugins: [convex({ authConfig })],
} satisfies BetterAuthOptions)
