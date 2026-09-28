import { expect, test } from '@playwright/test'

test('email and all three providers are visible, disabled honestly until configured', async ({ page }) => {
  await page.route('**/api/owner/auth-capabilities', route => route.fulfill({ json: { email: false, apple: false, google: false, discord: false } }))
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }))
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeDisabled()
  for (const provider of ['Apple', 'Google', 'Discord']) await expect(page.getByRole('button', { name: `Continue with ${provider}`, exact: false })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/vazhi-email-sign-in-mobile.png', fullPage: true })
})

test('email login submits through same-origin auth and enters the owner dashboard', async ({ page }) => {
  let signedIn = false
  await page.route('**/api/owner/auth-capabilities', route => route.fulfill({ json: { email: true, apple: true, google: true, discord: true } }))
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: signedIn ? { user: { id: 'owner', email: 'user@example.test', name: 'User' }, session: { id: 'session', userId: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString() } } : null }))
  await page.route('**/api/auth/sign-in/email', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ email: 'user@example.test', password: 'long-password' })
    signedIn = true
    await route.fulfill({ json: { user: { id: 'owner', email: 'user@example.test', name: 'User' }, token: 'session', redirect: false } })
  })
  await page.route('**/api/auth/convex/token', route => route.fulfill({ json: { token: 'jwt' } }))
  await page.route('**/api/owner/ask-requests', route => { expect(route.request().headers().authorization).toBe('Bearer jwt'); return route.fulfill({ json: [] }) })
  await page.route('**/api/auth/list-accounts', route => route.fulfill({ json: [] }))
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: true }).fill('user@example.test')
  await page.getByLabel('Password', { exact: true }).fill('long-password')
  await page.getByRole('button', { name: 'Sign in with email' }).click()
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByRole('heading', { name: 'Your requests' })).toBeVisible()
})

test('native handoff sends only a PKCE challenge after explicit user confirmation', async ({ page }) => {
  const challenge = 'a'.repeat(43), state = 'b'.repeat(43)
  await page.route('**/api/owner/auth-capabilities', route => route.fulfill({ json: { email: true, apple: true, google: true, discord: true } }))
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'owner', email: 'user@example.test' }, session: { id: 'session', userId: 'owner' } } }))
  let calls = 0
  await page.route('**/api/native/authorize', route => { calls++; expect(route.request().postDataJSON()).toEqual({ challenge }); return route.fulfill({ status: 401, json: { message: 'Sign in again.' } }) })
  await page.goto(`/sign-in?nativeChallenge=${challenge}&state=${state}`)
  await expect(page.getByRole('button', { name: 'Continue to Vazhi' })).toBeVisible()
  expect(calls).toBe(0)
  await page.getByRole('button', { name: 'Continue to Vazhi' }).click()
  await expect(page.getByRole('alert')).toHaveText('Sign in again.')
  expect(calls).toBe(1)
})

test('a native Google choice starts only Google sign-in and drops the choice from its callback', async ({ page }) => {
  const challenge = 'a'.repeat(43), state = 'b'.repeat(43)
  let socialCalls = 0
  await page.route('**/api/owner/auth-capabilities', route => route.fulfill({ json: { email: true, apple: true, google: true, discord: true } }))
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }))
  await page.route('**/api/auth/sign-in/social', route => {
    socialCalls++
    const body = route.request().postDataJSON() as { provider: string; callbackURL: string }
    expect(body.provider).toBe('google')
    expect(body.callbackURL).toContain(`nativeChallenge=${challenge}`)
    expect(body.callbackURL).not.toContain('provider=')
    return route.fulfill({ status: 503, json: { message: 'Provider unavailable' } })
  })
  await page.goto(`/sign-in?nativeChallenge=${challenge}&state=${state}&provider=google`)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(socialCalls).toBe(1)
})

test('an unavailable native provider stays on sign-in without a social request', async ({ page }) => {
  const challenge = 'a'.repeat(43), state = 'b'.repeat(43)
  let socialCalls = 0
  await page.route('**/api/owner/auth-capabilities', route => route.fulfill({ json: { email: true, apple: false, google: false, discord: false } }))
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }))
  await page.route('**/api/auth/sign-in/social', route => { socialCalls++; return route.fulfill({ status: 500 }) })
  await page.goto(`/sign-in?nativeChallenge=${challenge}&state=${state}&provider=discord`)
  await expect(page.getByRole('alert')).toContainText('Discord sign-in is not available yet')
  expect(socialCalls).toBe(0)
})

test('a provider query without native PKCE context does not auto-start sign-in', async ({ page }) => {
  let socialCalls = 0
  await page.route('**/api/owner/auth-capabilities', route => route.fulfill({ json: { email: true, apple: true, google: true, discord: true } }))
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }))
  await page.route('**/api/auth/sign-in/social', route => { socialCalls++; return route.fulfill({ status: 500 }) })
  await page.goto('/sign-in?provider=google')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  expect(socialCalls).toBe(0)
})
