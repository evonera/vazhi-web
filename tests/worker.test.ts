import { describe, expect, it } from 'vitest'
import worker, { type Env } from '../src/worker'

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {
      fetch: async () => new Response('<!doctype html><title>Vazhi</title>', { headers: { 'content-type': 'text/html' } }),
    },
    ...overrides,
  }
}

describe('Vazhi download route', () => {
  it('redirects iPhone visitors to the configured App Store destination', async () => {
    const response = await worker.fetch(new Request('https://vazhi.app/download', {
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
    }), environment({ IOS_APP_STORE_URL: 'https://apps.apple.com/app/vazhi/id1234567890' }))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://apps.apple.com/app/vazhi/id1234567890')
  })

  it('keeps a browser fallback when no App Store destination is configured', async () => {
    const response = await worker.fetch(new Request('https://vazhi.app/download', {
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    }), environment())

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Vazhi')
  })
})
