# Vazhi release preflight

## Current boundary (verified 25 September 2026)

| Environment | Public Worker | Convex site endpoint | Status |
| --- | --- | --- | --- |
| Preview | `https://vazhi-web-preview.polarityclo.workers.dev` | `https://brainy-cod-251.convex.site` | Worker and isolated Convex boundary respond. |
| Production | `https://vazhi-web.polarityclo.workers.dev` | `https://grandiose-wildebeest-800.convex.site` | Worker and production Convex boundary respond. |

Both Workers have Turnstile, edge-ingress, rate-limit, origin, and Convex-origin configuration. Both Convex deployments have separate Better Auth, edge-ingress, rate-limit, and Google Places/Routes configuration. Production and preview public forms reject unverified writes before Convex.

On 25 September 2026, the provider-aware Convex functions, account-deletion workflow, and website were deployed to both environments. The latest preview Worker version was `790e2f41-fb54-4ecd-bcdc-5fadf078f59e` and production version was `ad533b9a-b9f8-4b06-bd5c-73c6bc0862f4`. The four Google-detail and expired-route cleanup jobs completed in each deployment and purged zero records; the production tables were empty. The authenticated moderation queue returned HTTP 200 after its pagination fix. Home and demo pages loaded in a browser at desktop and 390px width without page errors; public invalid requests returned the expected 400/401/404 responses. The final backend build, 70 unit tests, 8 browser tests, Convex production dry run and deploy, and production Worker deploy passed. An unauthenticated deletion request returned HTTP 401. This is a boundary smoke check, not a completed authenticated end-to-end product test.

The website is publicly available on the production `workers.dev` URL above. `vazhi.app` is not yet attached: the current Cloudflare account has no `vazhi.app` zone, so a domain owner must add or delegate the zone before a Worker Custom Domain can be configured. Keep the iOS release web URL pointed at the live Worker until that is done.

Google Maps Platform billing is linked to `vazhi-509423`; Places API (New) and Routes API are enabled. The restricted production key is stored in Convex only. Earlier smoke checks returned HTTP 200 for Places Text Search and Compute Routes. This does not prove the full product flow or native map rendering.

The following remain deliberately absent until their providers are ready:

- `APPLE_SERVICE_ID` and `APPLE_CLIENT_SECRET`: require Apple Developer enrollment and Sign in with Apple web configuration.
- `REVENUECAT_WEBHOOK_SIGNING_SECRET` and `REVENUECAT_WEB_PURCHASE_LINK_PRODUCTION`: require RevenueCat Web/Paddle provider access and final `vazhi_pro` mapping.
- `IOS_APP_STORE_URL` and the final `vazhi.app` download route: require the App Store listing and branded domain.
- Native release keys `GOOGLE_MAPS_IOS_API_KEY` and the iOS public `REVENUECAT_API_KEY` are blank in `Config/Release.xcconfig`. Provision a bundle-restricted Maps SDK for iOS key and the RevenueCat App Store platform key before validating a signed release. The Test Store key in Debug is not suitable for production.
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

Builds typecheck both the website and Convex functions. Deploy the Worker only after deploying the matching Convex functions:

```sh
npm run deploy:preview -- --dry-run
npm run deploy:preview
npm run deploy:production -- --dry-run
npm run deploy:production
```

The deploy script injects the public Convex site URL and Turnstile site key for each target, uses Vite's generated Worker configuration, and preserves existing Worker secrets. `npm run deploy` without an explicit target exits without deploying.

## Google Places data migration gate

The September UI reconciliation changes storage so new Google recommendations, private Moments, Path stops, and published guides retain Place IDs without Google-returned names, addresses, types, or coordinates. Authenticated native views fetch details when visible. Public guides use an explicitly author-written stop label and link to Google Maps by Place ID.

Before releasing the new clients, deploy the backend schema and endpoints, then invoke the resumable internal purges for `sync.purgeGooglePlaceDetails`, `requests.purgeGoogleRecommendationDetails`, `requests.purgeGooglePathStopDetails`, and `routes.purgeExpiredRouteSnapshots`. Each accepts `paginationOpts` beginning with `{ "numItems": 100, "cursor": null }` and schedules subsequent pages. Verify completion and inspect a sample of each table. New route snapshots schedule their own physical deletion at expiry.

Legacy published-guide versions have no provider provenance. Review affected guides and obtain approval for `listings.purgeLegacyGuideStopDetails`: it replaces those older stop headings with generic labels and removes their location details. The operation cannot reconstruct lost user-authored headings. Verify the public guide response after migration. Older iOS clients must update before publishing because new publication input requires a place source on every stop.

The iOS client also purges older locally stored Google place details at startup. A failed local cleanup blocks normal app operations rather than leaving restricted fields available. Provision a separate iOS-restricted `GOOGLE_MAPS_IOS_API_KEY` and verify Places attribution, route maps, and offline fallback on device before release.

## Account deletion

The native app reauthenticates with Apple and calls Better Auth's `delete-user` endpoint using a fresh, in-memory session token. The app converts that account's local Journey ownership to guest before deletion, so a subsequent Apple sign-in cannot silently re-upload the old journal. Better Auth's deletion hooks create a cleanup job and, after the auth user is removed, schedule bounded pages across related cloud tables. A recovery job activates cleanup if the post-delete hook is interrupted. The job row is removed when cleanup finishes; inspect `accountDeletionJobs` for stalled jobs after launch. The deletion path has automated multi-table and multi-page coverage, but still requires a real Apple-account end-to-end test. Apple token revocation is a separate launch gate once the Developer configuration is available.
