import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { components } from '../_generated/api'
import type { DataModel } from '../_generated/dataModel'
import authConfig from '../auth.config'
import schema from './schema'

export const authComponent = createClient<DataModel, typeof schema>(components.betterAuth, {
  local: { schema },
})

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => ({
  appName: 'Vazhi',
  baseURL: process.env.CONVEX_SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.SITE_URL ?? 'http://localhost:5173'],
  database: authComponent.adapter(ctx),
  socialProviders: {
    apple: {
      clientId: process.env.APPLE_SERVICE_ID ?? '',
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
      appBundleIdentifier: process.env.APPLE_BUNDLE_ID,
    },
  },
  plugins: [convex({ authConfig, jwks: process.env.BETTER_AUTH_JWKS })],
} satisfies BetterAuthOptions)

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx))
