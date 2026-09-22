import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const script = resolve('scripts/preflight.mjs')
const base = {
  VAZHI_ENVIRONMENT: 'preview',
  BETTER_AUTH_SECRET: 'x', SITE_URL: 'https://preview.vazhi.app', APPLE_SERVICE_ID: 'x', APPLE_CLIENT_SECRET: 'x', APPLE_BUNDLE_ID: 'com.evonera.vazhi',
  GOOGLE_PLACES_API_KEY: 'x', GOOGLE_ROUTES_API_KEY: 'x', RATE_LIMIT_SALT: 'x', EDGE_INGRESS_SIGNING_SECRET: 'x',
  CONVEX_HTTP_URL: 'https://example.convex.site', TURNSTILE_SECRET_KEY: 'x', VITE_TURNSTILE_SITE_KEY: 'site-key',
}

describe('release preflight', () => {
  it('passes core preview without printing secret values', () => {
    const result = spawnSync(process.execPath, [script], { env: { ...process.env, ...base }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('preview core preflight passed')
    expect(result.stdout + result.stderr).not.toContain('site-key')
  })

  it('blocks missing release credentials and optional commerce configuration', () => {
    const core = spawnSync(process.execPath, [script], { env: { ...process.env, ...base, EDGE_INGRESS_SIGNING_SECRET: '' }, encoding: 'utf8' })
    expect(core.status).toBe(1)
    expect(core.stderr).toContain('EDGE_INGRESS_SIGNING_SECRET')
    const commerce = spawnSync(process.execPath, [script, '--commerce'], { env: { ...process.env, ...base }, encoding: 'utf8' })
    expect(commerce.status).toBe(1)
    expect(commerce.stderr).toContain('REVENUECAT_WEBHOOK_SIGNING_SECRET')
  })
})
