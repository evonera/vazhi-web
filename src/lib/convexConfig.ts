/**
 * Convex CLI writes `VITE_CONVEX_SITE_URL`; older Vazhi preview deployments
 * used `VITE_CONVEX_HTTP_URL`. Keep the latter as a migration fallback, but
 * always use one normalised origin for auth and HTTP actions.
 */
export const convexHTTPURL = (
  import.meta.env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_HTTP_URL ?? ''
).replace(/\/$/, '')
