import { expect, test } from '@playwright/test'

test('a visitor can submit a named recommendation through a public request', async ({ page }) => {
  await page.goto('/ask/demo-malaysia')
  await page.getByLabel('Your first name').fill('Shakthi')
  await page.getByLabel('Find a place').fill('Village Park')
  await page.getByRole('button', { name: /Village Park Restaurant/ }).click()
  await page.getByLabel('Why is it worth it?').fill('Order the nasi lemak and go early.')
  await page.getByRole('button', { name: 'Send recommendation' }).click()
  await expect(page.getByRole('heading', { name: 'Recommendation sent.' })).toBeVisible()
})

test('a failed public submission resets the single-use safety token before retry', async ({ page }) => {
  const submittedTokens: string[] = []
  const submittedIDs: string[] = []
  let resetCalls = 0
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: `window.turnstile = {
      render: (_element, options) => { window.turnstileOptions = options; setTimeout(() => options.callback('first-token'), 0); return 'test-widget' },
      reset: () => { window.turnstileResetCalls = (window.turnstileResetCalls || 0) + 1; window.turnstileOptions.callback('second-token') },
      remove: () => {}
    }`,
  }))
  await page.route('**/api/ask?slug=retry-link', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ slug: 'retry-link', prompt: 'Where should I go?', destination: 'Malaysia', status: 'open' }),
  }))
  await page.route('**/places/search', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ provider: 'manual', name: 'Public market', latitude: 3.136, longitude: 101.619 }]),
  }))
  await page.route('**/api/recommendations', async route => {
    const body = route.request().postDataJSON() as { turnstileToken: string; clientSubmissionID: string }
    submittedTokens.push(body.turnstileToken)
    submittedIDs.push(body.clientSubmissionID)
    if (submittedTokens.length === 1) await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Please try again.' }) })
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
  })

  await page.goto('/ask/retry-link')
  await page.getByLabel('Submit anonymously').check()
  await expect(page.getByLabel('Instagram handle')).toHaveCount(0)
  await page.getByLabel('Submit anonymously').uncheck()
  await page.getByLabel('Your first name').fill('Shakthi')
  await page.getByLabel('Find a place').fill('Public market')
  await page.getByRole('button', { name: 'Public market' }).click()
  await page.getByLabel('Why is it worth it?').fill('Great food stalls.')
  await page.getByRole('button', { name: 'Send recommendation' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Please try again.' })).toBeVisible()
  resetCalls = await page.evaluate(() => (window as typeof window & { turnstileResetCalls?: number }).turnstileResetCalls ?? 0)
  expect(resetCalls).toBe(1)
  await page.getByRole('button', { name: 'Send recommendation' }).click()
  await expect(page.getByRole('heading', { name: 'Recommendation sent.' })).toBeVisible()
  expect(submittedTokens).toEqual(['first-token', 'second-token'])
  expect(submittedIDs[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(submittedIDs[1]).toBe(submittedIDs[0])
})

test('a committed recommendation with a lost response reuses its ID after page reload', async ({ page }) => {
  const receivedIDs: string[] = []
  const committed = new Set<string>()
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: `window.turnstile = {
      render: (_element, options) => { window.turnstileOptions = options; setTimeout(() => options.callback('fresh-token'), 0); return 'test-widget' },
      reset: () => { window.turnstileOptions.callback('retry-token') },
      remove: () => {}
    }`,
  }))
  await page.route('**/api/ask?slug=lost-response', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ slug: 'lost-response', prompt: 'Where should I go?', destination: 'Malaysia', status: 'open' }),
  }))
  await page.route('**/places/search', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ provider: 'manual', name: 'Public market', latitude: 3.136, longitude: 101.619 }]),
  }))
  await page.route('**/api/recommendations', async route => {
    const body = route.request().postDataJSON() as { clientSubmissionID: string }
    receivedIDs.push(body.clientSubmissionID)
    committed.add(body.clientSubmissionID) // The server commits before its response is lost.
    await route.fulfill({ status: receivedIDs.length === 1 ? 502 : 200, contentType: 'application/json',
      body: JSON.stringify(receivedIDs.length === 1 ? { message: 'Connection lost.' } : { accepted: true }) })
  })

  const completeForm = async () => {
    await page.getByLabel('Your first name').fill('Shakthi')
    await page.getByLabel('Find a place').fill('Public market')
    await page.getByRole('button', { name: 'Public market' }).click()
    await page.getByLabel('Why is it worth it?').fill('Great food stalls.')
    await page.getByRole('button', { name: 'Send recommendation' }).click()
  }
  await page.goto('/ask/lost-response')
  await completeForm()
  await expect(page.getByRole('alert').filter({ hasText: 'Connection lost.' })).toBeVisible()
  const saved = await page.evaluate(() => sessionStorage.getItem('vazhi:ask-submission:lost-response'))
  expect(saved).not.toContain('Great food stalls.')

  await page.reload()
  await completeForm()
  await expect(page.getByRole('heading', { name: 'Recommendation sent.' })).toBeVisible()
  expect(receivedIDs[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(receivedIDs[1]).toBe(receivedIDs[0])
  expect(committed.size).toBe(1)
})

test('manual public-place coordinates remain usable when search is unavailable', async ({ page }) => {
  await page.route('**/api/ask?slug=offline-places', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ slug: 'offline-places', prompt: 'Where should I go?', destination: 'Malaysia', status: 'open' }),
  }))
  await page.route('**/places/search', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await page.goto('/ask/offline-places')
  await page.getByLabel('Find a place').fill('Village Park')
  await expect(page.getByRole('alert').filter({ hasText: 'Place search is unavailable' })).toBeVisible()
  await page.getByText('Can’t find the place? Add a manual pin').click()
  await page.getByLabel('Place name').fill('Village Park Restaurant')
  await page.getByLabel('Latitude').fill('3.136')
  await page.getByLabel('Longitude').fill('101.619')
  await page.getByRole('button', { name: 'Use this pin' }).click()
  await expect(page.getByLabel('Find a place')).toHaveValue('Village Park Restaurant')
  await expect(page.getByRole('alert').filter({ hasText: 'Place search is unavailable' })).toHaveCount(0)
})

test('the campaign and public form stay usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Capture places/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /iPhone launch details/i }).first()).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.goto('/ask/demo-malaysia')
  await expect(page.getByRole('heading', { name: /Going to Malaysia/i })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('campaign copy and app previews stay separated across responsive breakpoints', async ({ page }) => {
  for (const width of [320, 390, 640, 641, 768, 840]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const gap = await page.evaluate(() => {
      const copy = document.querySelector('.hero-copy')!.getBoundingClientRect()
      const previews = document.querySelector('.device-stack')!.getBoundingClientRect()
      return previews.top - copy.bottom
    })
    expect(gap, `vertical copy-to-preview gap at ${width}px`).toBeGreaterThanOrEqual(0)
  }

  for (const width of [841, 1000, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const gap = await page.evaluate(() => {
      const copy = document.querySelector('.hero-copy')!.getBoundingClientRect()
      const previews = document.querySelector('.device-stack')!.getBoundingClientRect()
      return previews.left - copy.right
    })
    expect(gap, `horizontal copy-to-preview gap at ${width}px`).toBeGreaterThanOrEqual(0)
  }
})

test('prototype-shaped slugs are never treated as built-in demos', async ({ page }) => {
  let requestCount = 0
  await page.route('**/api/ask?slug=**', async (route) => {
    requestCount += 1
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) })
  })

  for (const slug of ['constructor', 'toString', '__proto__']) {
    await page.goto(`/ask/${slug}`)
    await expect(page.getByRole('heading', { name: 'This request is unavailable.' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Send recommendation/i })).toHaveCount(0)
  }
  // React development mode can replay effects; every prototype-shaped slug
  // must still leave the demo allowlist and attempt the public API.
  expect(requestCount).toBeGreaterThanOrEqual(3)
})

test('campaign has no horizontal overflow at required handoff widths', async ({ page }) => {
  for (const width of [320, 390, 640, 841, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  }
})
