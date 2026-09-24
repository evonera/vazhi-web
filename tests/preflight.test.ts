import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const script = resolve('scripts/preflight.mjs')
const base = {
  VAZHI_ENVIRONMENT: 'preview',
  BETTER_AUTH_SECRET: 'secret-value', SITE_URL: 'https://preview.vazhi.app',
  APPLE_SERVICE_ID: 'service-id', APPLE_CLIENT_SECRET: 'apple-secret',
  APPLE_BUNDLE_ID: 'com.evonera.vazhi', GOOGLE_PLACES_API_KEY: 'places-secret',
  GOOGLE_ROUTES_API_KEY: 'routes-secret', MODERATION_API_TOKEN: 'moderation-secret',
  RATE_LIMIT_SALT: 'rate-secret', EDGE_INGRESS_SIGNING_SECRET: 'edge-secret',
  CONVEX_HTTP_URL: 'https://example.convex.site', PUBLIC_WEB_ORIGIN: 'https://preview.vazhi.app',
  TURNSTILE_SECRET_KEY: 'turnstile-secret', VITE_TURNSTILE_SITE_KEY: 'site-key',
}

describe('release preflight', () => {
  it('passes a target-specific preview preflight without printing secret values', () => {
    const result = spawnSync(process.execPath, [script, '--target=convex'], {
      env: { ...process.env, ...base }, encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('preview convex core preflight passed')
    expect(result.stdout + result.stderr).not.toContain('places-secret')
  })

  it('blocks missing release credentials and optional commerce configuration', () => {
    const core = spawnSync(process.execPath, [script, '--target=worker'], {
      env: { ...process.env, ...base, EDGE_INGRESS_SIGNING_SECRET: '' }, encoding: 'utf8',
    })
    expect(core.status).toBe(1)
    expect(core.stderr).toContain('EDGE_INGRESS_SIGNING_SECRET')

    const commerce = spawnSync(process.execPath, [script, '--target=convex', '--commerce'], {
      env: { ...process.env, ...base }, encoding: 'utf8',
    })
    expect(commerce.status).toBe(1)
    expect(commerce.stderr).toContain('REVENUECAT_WEBHOOK_SIGNING_SECRET')
  })

  it('rejects an unknown deployment target', () => {
    const result = spawnSync(process.execPath, [script, '--target=browser'], {
      env: { ...process.env, ...base }, encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Preflight target')
  })
})
