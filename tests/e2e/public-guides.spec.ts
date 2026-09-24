import { expect, test } from '@playwright/test'

test('profiles show only public guides and immutable guide versions can be reported', async ({ page }) => {
  await page.route('**/api/profile?handle=asha', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      handle: 'asha',
      displayName: 'Asha Rao',
      bio: 'Slow mornings and coastal walks.',
      listings: [{ slug: 'penang-walk', title: 'Penang on foot', destination: 'George Town, Malaysia', subtitle: 'A gentle old-town route.', stopCount: 2, updatedAt: 1 }],
    }),
  }))
  await page.route('**/api/listing?**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('version')).toBe('1')
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        handle: 'asha', displayName: 'Asha Rao', slug: 'penang-walk', visibility: 'public', versionNumber: 1,
        title: 'Penang on foot · first edition', destination: 'George Town, Malaysia', subtitle: 'A gentle old-town route.',
        disclaimer: 'Traveler notes; verify details before visiting.', approximateLocations: true, publishedAt: 1,
        stops: [{ orderIndex: 0, title: 'Breakfast lane', notes: 'Go early.', placeName: 'Old Town', isApproximateLocation: true }],
      }),
    })
  })
  await page.route('**/api/reports', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accepted: true }) }))

  await page.goto('/@asha')
  await expect(page.getByRole('heading', { name: 'Asha Rao' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Penang on foot' })).toBeVisible()
  await expect(page.getByText('George Town, Malaysia')).toBeVisible()
  await expect(page.getByText('Secret home itinerary')).toHaveCount(0)

  await page.goto('/@asha/penang-walk?version=1')
  await expect(page.getByRole('heading', { name: 'Penang on foot · first edition' })).toBeVisible()
  await expect(page.getByText('George Town, Malaysia')).toBeVisible()
  await expect(page.getByText('Breakfast lane')).toBeVisible()
  await page.getByRole('button', { name: 'Report this guide' }).click()
  await page.getByLabel('Reason').selectOption({ label: 'Unsafe or misleading travel information' })
  await page.getByLabel('Details').fill('This route needs a correction.')
  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByRole('status')).toHaveText('Thanks — your report was received.')
})
