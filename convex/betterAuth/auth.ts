import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import type { GenericCtx } from '@convex-dev/better-auth/utils'
import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { components } from '../_generated/api'
import type { DataModel } from '../_generated/dataModel'
import authConfig from '../auth.config'
import schema from './schema'

type BetterAuthComponent = Parameters<typeof createClient<DataModel, typeof schema>>[0]

// Before the first successful deployment Convex generates `components` as an
// untyped generic map. This narrow component-API assertion keeps the adapter
// contract checked without disabling backend type checking during bootstrap.
const betterAuthComponent = components.betterAuth as unknown as BetterAuthComponent

export const authComponent = createClient<DataModel, typeof schema>(betterAuthComponent, {
  local: { schema },
})

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth({
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
  plugins: [convex({ authConfig })],
} satisfies BetterAuthOptions)
