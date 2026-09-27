import { createAuthClient } from 'better-auth/react'
const baseURL = window.location.origin

export const authClient = createAuthClient({ baseURL })

export async function getConvexAccessToken() {
  const response = await fetch(`${baseURL}/api/auth/convex/token`, { credentials: 'include' })
  if (!response.ok) throw new Error('Sign in to continue.')
  return (await response.json() as { token: string }).token
}
