import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

// Better Auth issues the short-lived custom JWT accepted by Convex. Convex
// resolves the public keys through Better Auth's server-side JWKS endpoint;
// private key material remains in the Better Auth component database.
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
