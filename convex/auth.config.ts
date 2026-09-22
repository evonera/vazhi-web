import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

// Better Auth issues the short-lived custom JWT accepted by Convex. The issuer,
// audience and JWKS endpoint are derived from CONVEX_SITE_URL; no static key
// material is required in deployment configuration or browser code.
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
