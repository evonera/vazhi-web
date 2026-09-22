/** Build an identified, production RevenueCat Web Purchase Link.
 * The template comes from the RevenueCat dashboard, not from a caller.
 */
export function identifiedWebPurchaseLink(template: string | undefined, appUserID: string): string | null {
  if (!template || !appUserID || appUserID.length > 256) return null
  try {
    const url = new URL(template)
    if (url.protocol !== 'https:' || url.hostname !== 'pay.rev.cat' || url.port ||
        url.username || url.password || url.search || url.hash ||
        !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(appUserID)}`
    return url.toString()
  } catch {
    return null
  }
}
