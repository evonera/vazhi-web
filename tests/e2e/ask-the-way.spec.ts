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
