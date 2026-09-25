#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

// These values are public client configuration. Server secrets remain in the
// matching Cloudflare Worker and Convex deployments.
const targets = {
  preview: {
    worker: 'vazhi-web-preview',
    convexSite: 'https://brainy-cod-251.convex.site',
    turnstileSiteKey: '0x4AAAAAAFAbif8GN52UP1uW',
  },
  production: {
    worker: 'vazhi-web',
    convexSite: 'https://grandiose-wildebeest-800.convex.site',
    turnstileSiteKey: '0x4AAAAAAFAa9LoMH3SgXkCc',
  },
}

const targetName = process.argv[2]
const target = targets[targetName]
const dryRun = process.argv.slice(3).includes('--dry-run')
if (!target || process.argv.slice(3).some((argument) => argument !== '--dry-run')) {
  console.error('Use npm run deploy:preview or npm run deploy:production, optionally with -- --dry-run.')
  process.exit(1)
}

const env = {
  ...process.env,
  VITE_CONVEX_SITE_URL: target.convexSite,
  VITE_TURNSTILE_SITE_KEY: target.turnstileSiteKey,
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['run', 'build'])
run('npx', [
  'wrangler', 'deploy',
  '--config', 'dist/vazhi_web/wrangler.json',
  '--name', target.worker,
  '--keep-vars',
  ...(dryRun ? ['--dry-run'] : []),
])
