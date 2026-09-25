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

export const authComponent = createClient<DataModel, typeof schema>(components.betterAuth, {
  local: { schema },
})

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth({
  appName: 'Vazhi',
  baseURL: process.env.CONVEX_SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.SITE_URL ?? 'http://localhost:5173'],
  database: authComponent.adapter(ctx),
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
    apple: {
      clientId: process.env.APPLE_SERVICE_ID ?? '',
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
      appBundleIdentifier: process.env.APPLE_BUNDLE_ID,
    },
  },
  plugins: [convex({ authConfig })],
} satisfies BetterAuthOptions)
