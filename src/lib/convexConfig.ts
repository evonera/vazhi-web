/** Normalise the current Convex CLI name while retaining the earlier fallback. */
export const convexHTTPURL = (
  import.meta.env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_HTTP_URL ?? ''
).replace(/\/$/, '')
