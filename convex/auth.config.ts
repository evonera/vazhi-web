import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

// Better Auth issues the short-lived custom JWT accepted by Convex. The issuer
// and JWKS are derived from CONVEX_SITE_URL, never shipped to the browser.
export default {
  providers: [getAuthConfigProvider({ jwks: process.env.BETTER_AUTH_JWKS })],
} satisfies AuthConfig
