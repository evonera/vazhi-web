# Vazhi release preflight

## Current boundary (verified 25 September 2026)

| Environment | Public Worker | Convex site endpoint | Status |
| --- | --- | --- | --- |
| Preview | `https://vazhi-web-preview.polarityclo.workers.dev` | `https://brainy-cod-251.convex.site` | Worker and isolated Convex boundary respond. |
| Production | `https://vazhi-web.polarityclo.workers.dev` | `https://grandiose-wildebeest-800.convex.site` | Worker and production Convex boundary respond. |

Both Workers have Turnstile, edge-ingress, rate-limit, origin, and Convex-origin configuration. Both Convex deployments have separate Better Auth, edge-ingress, rate-limit, and Google Places/Routes configuration. Production and preview public forms reject unverified writes before Convex.

Google Maps Platform billing is linked to `vazhi-509423`; Places API (New) and Routes API are enabled. The restricted production key is stored in Convex only. Earlier smoke checks returned HTTP 200 for Places Text Search and Compute Routes. This does not prove the full product flow or native map rendering.

The following remain deliberately absent until their providers are ready:

- `APPLE_SERVICE_ID` and `APPLE_CLIENT_SECRET`: require Apple Developer enrollment and Sign in with Apple web configuration.
- `REVENUECAT_WEBHOOK_SIGNING_SECRET` and `REVENUECAT_WEB_PURCHASE_LINK_PRODUCTION`: require RevenueCat Web/Paddle provider access and final `vazhi_pro` mapping.
- `IOS_APP_STORE_URL` and the final `vazhi.app` download route: require the App Store listing and branded domain.
- cloud AI provider variables are optional; the core product and on-device AI must continue to work without them.

## Run the preflight

Run in each provider's secret-injected environment. The command reports missing variable names only, never values:

```sh
npm run preflight:release -- --target=convex
npm run preflight:release -- --target=worker
npm run preflight:release -- --target=convex --commerce
```

Set `VAZHI_ENVIRONMENT` to `preview` or `production`. Use `--commerce` only when enabling RevenueCat Web/Paddle. Keep `EDGE_INGRESS_SIGNING_SECRET` and `RATE_LIMIT_SALT` paired between the matching Worker and Convex deployment. `TURNSTILE_SECRET_KEY` belongs only in the Worker; `VITE_TURNSTILE_SITE_KEY` is intentionally public build configuration.

Presence checks cannot prove that credentials authorize the intended API. After preflight, run the deployed sign-in, place-search, route, Turnstile, and full Ask-the-Way flow. Never paste secret values into a terminal command merely to run this script.
