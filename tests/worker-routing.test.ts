import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

test('browser OAuth callbacks reach the Worker before the SPA fallback', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
    assets?: { not_found_handling?: string; run_worker_first?: string[] }
  }

  expect(config.assets?.not_found_handling).toBe('single-page-application')
  expect(config.assets?.run_worker_first).toContain('/api/*')
})
