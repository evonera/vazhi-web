import { createAuthClient } from 'better-auth/react'

const baseURL = import.meta.env.VITE_CONVEX_HTTP_URL

export const authClient = createAuthClient({ baseURL })

export function ownerSignInReturnPath(requested: string | null): '/requests' | '/pro' {
  return requested === '/pro' ? '/pro' : '/requests'
}

export async function startAppleSignIn(returnPath: '/requests' | '/pro' = '/requests') {
  if (!baseURL) throw new Error('Apple sign-in is not configured for this environment.')
  await authClient.signIn.social({ provider: 'apple', callbackURL: `${window.location.origin}${returnPath}` })
}

export async function getConvexAccessToken() {
  if (!baseURL) throw new Error('Owner access is not configured for this environment.')
  const response = await fetch(`${baseURL}/api/auth/convex/token`, { credentials: 'include' })
  if (!response.ok) throw new Error('Sign in to continue.')
  return (await response.json() as { token: string }).token
}
