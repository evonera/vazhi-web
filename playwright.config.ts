import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4185' },
  webServer: {
    command: 'npm run dev -- --port 4185',
    port: 4185,
    reuseExistingServer: !process.env.CI,
    env: { VITE_CONVEX_HTTP_URL: 'http://127.0.0.1:8788', VITE_TURNSTILE_SITE_KEY: 'test-site-key' },
  },
})
