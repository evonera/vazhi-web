# Vazhi release preflight

## Provisioned boundary (September 2026)

The public edge and data boundaries are deployed, but this is **not** a
declaration that every paid or third-party capability is live:

| Environment | Public Worker | Convex site endpoint | Status |
| --- | --- | --- | --- |
| Preview | `https://vazhi-web-preview.polarityclo.workers.dev` | `https://brainy-cod-251.convex.site` | Isolated preview boundary deployed. |
| Production | `https://vazhi-web.polarityclo.workers.dev` | `https://grandiose-wildebeest-800.convex.site` | Production boundary deployed. |

Each Worker has its own Turnstile widget and its own edge-ingress/rate-limit
secrets. Both Convex deployments have separate Better Auth, edge-ingress and
rate-limit secrets. The production and preview public form currently rejects an
unverified submission before it reaches Convex.

The following are deliberately absent until their providers are ready:

- `GOOGLE_PLACES_API_KEY` and `GOOGLE_ROUTES_API_KEY`: Google Maps Platform
  billing must first be eligible for the `vazhi` project. Enable **Places API
  (New)** and **Routes API** only; do not enable Places API (Legacy). Create a
  server-only key restricted to those APIs and put it in the corresponding
  Convex deployment.
- `APPLE_SERVICE_ID` and `APPLE_CLIENT_SECRET`: require Apple Developer
  enrollment and the Sign in with Apple web configuration. `APPLE_BUNDLE_ID`
  is already recorded, but it is not sufficient to activate web/native auth.
- `REVENUECAT_WEBHOOK_SIGNING_SECRET` and
  `REVENUECAT_WEB_PURCHASE_LINK_PRODUCTION`: remain unset until a RevenueCat
  project administrator enables a Web provider, connects Paddle Billing and
  maps the intended web Pro product to `vazhi_pro`.
- `IOS_APP_STORE_URL` and a custom `vazhi.app` route: defer until the App Store
  listing and domain zone are available. The Workers URLs above are temporary
  public origins, not the final branded domain.

Never substitute an unrelated Google key, a Paddle sandbox URL, or a Test Store
key for any of these production settings.

Run the release preflight separately in each deployment target's secret-injected environment. It reports only missing variable names, never values:

```sh
npm run preflight:release -- --target=convex
npm run preflight:release -- --target=worker
npm run preflight:release -- --target=convex --commerce
```

Set `VAZHI_ENVIRONMENT` to `preview` or `production` through the deployment provider. `--commerce` is required only when RevenueCat Web/Paddle is being enabled, and applies to the Convex target where those values are consumed. Keep its production purchase-link and webhook signing secret out of the core launch until the RevenueCat project owner has completed the provider mapping.

For each preview and production environment, set `EDGE_INGRESS_SIGNING_SECRET` and `RATE_LIMIT_SALT` to the same values in both Convex and the Cloudflare Worker. Set `TURNSTILE_SECRET_KEY` in the Worker only; `VITE_TURNSTILE_SITE_KEY` is intentionally public and belongs in the web build configuration.

Do not run the preflight with copied secrets in a terminal command. Use the hosting provider's environment/secret injection instead.
