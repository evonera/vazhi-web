import { expect, test } from '@playwright/test'

test('shared website tokens meet contrast, sizing and appearance expectations', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ask/demo-malaysia')
    const metrics = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const luminance = (hex: string) => {
        const channels = hex.trim().replace('#', '').match(/.{2}/g)!.map(value => {
          const channel = parseInt(value, 16) / 255
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
        })
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
      }
      const contrast = (foreground: string, background: string) => {
        const first = luminance(styles.getPropertyValue(foreground))
        const second = luminance(styles.getPropertyValue(background))
        return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
      }
      const input = document.querySelector<HTMLInputElement>('input:not([type=checkbox])')!
      return {
        canvas: styles.getPropertyValue('--canvas').trim(),
        bodyContrast: contrast('--ink', '--canvas'),
        secondaryContrast: contrast('--supporting', '--card'),
        linkContrast: contrast('--accent', '--card'),
        buttonContrast: contrast('--on-action', '--action'),
        borderContrast: contrast('--control-border', '--canvas'),
        inputFontSize: parseFloat(getComputedStyle(input).fontSize),
        inputHeight: input.getBoundingClientRect().height,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        continuousAnimations: document.getAnimations().length,
        externalFonts: [...document.styleSheets].some(sheet => sheet.href?.includes('fonts.googleapis.com')),
      }
    })
    expect(metrics.canvas).toBe(colorScheme === 'light' ? '#fbf8f5' : '#121114')
    expect(metrics.bodyContrast).toBeGreaterThanOrEqual(4.5)
    expect(metrics.secondaryContrast).toBeGreaterThanOrEqual(4.5)
    expect(metrics.linkContrast).toBeGreaterThanOrEqual(4.5)
    expect(metrics.buttonContrast).toBeGreaterThanOrEqual(4.5)
    expect(metrics.borderContrast).toBeGreaterThanOrEqual(3)
    expect(metrics.inputFontSize).toBeGreaterThanOrEqual(16)
    expect(metrics.inputHeight).toBeGreaterThanOrEqual(44)
    expect(metrics.scrollBehavior).toBe('auto')
    expect(metrics.continuousAnimations).toBe(0)
    expect(metrics.externalFonts).toBe(false)
    await page.screenshot({ path: `/tmp/vazhi-website-release-ask-mobile-${colorScheme}.png`, fullPage: true })
  }
})

test('all public pages preserve compact navigation and prevent horizontal overflow', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/privacy', '/terms', '/report', '/download', '/ask/demo-malaysia', '/ask/demo-malaysia-closed']) {
      await page.goto(path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at ${width}px`).toBe(true)
      if (!path.startsWith('/ask')) await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
    }
  }
})

test('keyboard focus is visible and public forms survive 200 percent text', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ask/demo-malaysia')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'vazhi', exact: true }).first()).toBeFocused()
  const outline = await page.getByRole('link', { name: 'vazhi', exact: true }).first().evaluate(element => getComputedStyle(element).outlineStyle)
  expect(outline).toBe('solid')
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel('Your first name').fill('Shakthi')
  await page.getByLabel('Find a place').fill('Village Park')
  await page.getByRole('button', { name: /Village Park Restaurant/ }).click()
  await page.getByLabel('Why is it worth it?').fill('Go early for breakfast.')
  await page.getByRole('button', { name: 'Send recommendation' }).click()
  await expect(page.getByRole('heading', { name: 'Recommendation sent.' })).toBeVisible()
})

test('capture current mobile and desktop theme and privacy evidence', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.screenshot({ path: `/tmp/vazhi-website-release-home-mobile-${colorScheme}-viewport.png` })
    await page.screenshot({ path: `/tmp/vazhi-website-release-home-mobile-${colorScheme}.png`, fullPage: true })
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: 'Optional video imports and AI' })).toBeVisible()
    await expect(page.getByText(/Modal runs the processing/)).toBeVisible()
    await expect(page.getByText(/OpenAI to create highlights, summaries, tags, and tips/)).toBeVisible()
    await expect(page.getByText(/Voice transcripts, photos, audio, dates, coordinates, and Journey details are excluded/)).toBeVisible()
    await page.screenshot({ path: `/tmp/vazhi-website-release-privacy-mobile-${colorScheme}.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/')
    await page.screenshot({ path: `/tmp/vazhi-website-release-home-desktop-${colorScheme}-viewport.png` })
    await page.screenshot({ path: `/tmp/vazhi-website-release-home-desktop-${colorScheme}.png`, fullPage: true })
  }
})
