import { createAuthClient } from 'better-auth/react'
import { convexHTTPURL } from './convexConfig'

const baseURL = convexHTTPURL

export const authClient = createAuthClient({ baseURL })

export async function startAppleSignIn() {
  if (!baseURL) throw new Error('Apple sign-in is not configured for this environment.')
  await authClient.signIn.social({ provider: 'apple', callbackURL: `${window.location.origin}/requests` })
}

export async function getConvexAccessToken() {
  if (!baseURL) throw new Error('Owner access is not configured for this environment.')
  const response = await fetch(`${baseURL}/api/auth/convex/token`, { credentials: 'include' })
  if (!response.ok) throw new Error('Sign in to continue.')
  return (await response.json() as { token: string }).token
}
