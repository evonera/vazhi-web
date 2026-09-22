#!/usr/bin/env node

// Deliberately prints variable *names only*. Run this in CI or through the
// deployment platform's secret-injection command; never source production
// secrets into a shell transcript just to inspect them.
const mode = process.argv.includes('--commerce') ? 'commerce' : 'core'
const environment = process.env.VAZHI_ENVIRONMENT
const targetFlag = process.argv.find((argument) => argument.startsWith('--target='))
const target = targetFlag?.slice('--target='.length) ?? 'all'

const convexRequired = [
  'BETTER_AUTH_SECRET', 'SITE_URL', 'APPLE_SERVICE_ID', 'APPLE_CLIENT_SECRET',
  'APPLE_BUNDLE_ID', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_ROUTES_API_KEY',
  'RATE_LIMIT_SALT', 'EDGE_INGRESS_SIGNING_SECRET',
]
const workerRequired = [
  'CONVEX_HTTP_URL', 'TURNSTILE_SECRET_KEY', 'RATE_LIMIT_SALT',
  'EDGE_INGRESS_SIGNING_SECRET', 'VITE_TURNSTILE_SITE_KEY',
]
const commerceRequired = [
  'REVENUECAT_WEBHOOK_SIGNING_SECRET', 'REVENUECAT_WEB_PURCHASE_LINK_PRODUCTION',
]

const missing = (names) => names.filter((name) => !process.env[name]?.trim())
const targetSections = {
  convex: [['Convex', missing(convexRequired)]],
  worker: [['Cloudflare Worker', missing(workerRequired)]],
  all: [
    ['Convex', missing(convexRequired)],
    ['Cloudflare Worker', missing(workerRequired)],
  ],
}

if (!Object.hasOwn(targetSections, target)) {
  console.error('Preflight target must be "convex", "worker", or "all".')
  process.exitCode = 1
}

const sections = [
  ...(targetSections[target] ?? []),
  ...(mode === 'commerce' && (target === 'convex' || target === 'all') ? [['RevenueCat Web', missing(commerceRequired)]] : []),
]

if (!['preview', 'production'].includes(environment ?? '')) {
  console.error('VAZHI_ENVIRONMENT must be exactly "preview" or "production" for a release preflight.')
  process.exitCode = 1
}

for (const [name, absent] of sections) {
  if (absent.length > 0) {
    console.error(`${name} is missing: ${absent.join(', ')}`)
    process.exitCode = 1
  }
}

if (!process.exitCode) console.log(`Vazhi ${environment} ${target} ${mode} preflight passed.`)
