import { expect, test } from '@playwright/test'

test('a visitor can submit a named recommendation through a public request', async ({ page }) => {
  await page.goto('/ask/demo-malaysia')
  await page.getByLabel('Your first name').fill('Shakthi')
  await page.getByLabel('Find a place').fill('Village Park')
  await page.getByRole('button', { name: /Village Park Restaurant/ }).click()
  await page.getByLabel('Why is it worth it?').fill('Order the nasi lemak and go early.')
  await page.getByRole('button', { name: 'Add to their path' }).click()
  await expect(page.getByRole('heading', { name: 'That’s on their path.' })).toBeVisible()
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
    await expect(page.getByRole('button', { name: /Add to their path/i })).toHaveCount(0)
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
