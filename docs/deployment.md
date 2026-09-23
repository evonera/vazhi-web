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

Google Maps Platform billing is linked to `vazhi-509423`, and **Places API
(New)** and **Routes API** are enabled there. The initially supplied key was
owned by a different Google Cloud project (the Places API returned
`API_KEY_SERVICE_BLOCKED`); it was not added to Vazhi's credentials. A new key
was created in `vazhi-509423`, restricted to Places API (New) and Routes API,
and stored in Convex production under both `GOOGLE_PLACES_API_KEY` and
`GOOGLE_ROUTES_API_KEY`. Live smoke requests to Places Text Search and Routes
Compute Routes both returned HTTP 200. The production environment currently
uses one combined key for both settings; separate API/environment keys can be
introduced later for independent rotation and quota control. The earlier key
was replaced in Convex production but has **not** been revoked in its original
Google Cloud project. Revoke it there once confirmed unused.

The Maps key belongs in Convex secrets only, never in Worker variables, a
browser bundle, an iOS app, or Git. A passing Maps smoke test does not mean the
whole product is release-ready: Apple sign-in, Turnstile, required production
secrets, and end-to-end flows still need their own release checks.
The native `/api/owner/places/search` route is authenticated and rate-limited
before its Google call; the public Ask search remains a separately signed,
slug-scoped Worker route. Native guests use Apple Maps search or a named pin
and never receive a Google API key. The native build still needs its
environment-specific `ASK_THE_WAY_API_BASE_URL` pointed at the matching Convex
site endpoint after Apple sign-in credentials are provisioned.

The following are deliberately absent until their providers are ready:

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

Never treat an unrelated Google key, a Paddle sandbox URL, or a Test Store key
as a valid production setting. Presence-only preflight cannot prove that an API
key belongs to the right Google project or authorizes the intended API.

Run the release preflight separately in each deployment target's secret-injected environment. It reports only missing variable names, never values:

```sh
npm run preflight:release -- --target=convex
npm run preflight:release -- --target=worker
npm run preflight:release -- --target=convex --commerce
```

Set `VAZHI_ENVIRONMENT` to `preview` or `production` through the deployment provider. `--commerce` is required only when RevenueCat Web/Paddle is being enabled, and applies to the Convex target where those values are consumed. Keep its production purchase-link and webhook signing secret out of the core launch until the RevenueCat project owner has completed the provider mapping.

For each preview and production environment, set `EDGE_INGRESS_SIGNING_SECRET` and `RATE_LIMIT_SALT` to the same values in both Convex and the Cloudflare Worker. Set `TURNSTILE_SECRET_KEY` in the Worker only; `VITE_TURNSTILE_SITE_KEY` is intentionally public and belongs in the web build configuration.

Do not run the preflight with copied secrets in a terminal command. Use the hosting provider's environment/secret injection instead.
