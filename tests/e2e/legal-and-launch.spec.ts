import { expect, test } from '@playwright/test'

test('privacy, terms, and reporting pages explain the live product', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What stays on your device' })).toBeVisible()
  await expect(page.getByText('hello@vazhi.app').first()).toBeVisible()

  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Travel information' })).toBeVisible()

  await page.goto('/report')
  await expect(page.getByText('Report this guide', { exact: false })).toBeVisible()
})

test('launch links point to the current site and describe app availability honestly', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'iPhone launch details' }).first()).toHaveAttribute('href', '/download')
  const qr = page.getByRole('link', { name: 'Open Vazhi download page' })
  await expect(qr).toHaveAttribute('href', '/download')
  await expect(qr.locator('svg')).toBeVisible()
  await page.goto('/download')
  await expect(page.getByRole('heading', { name: 'Vazhi for iPhone is almost here.' })).toBeVisible()
})
