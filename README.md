# Vazhi Web

The public companion to Vazhi iOS. **Ask the Way** lets a traveller share one link, receive trusted place recommendations, and turn accepted suggestions into a private Path.

## Local setup

```sh
npm install
cp .env.example .env.local
npm run dev
```

`/ask/demo-malaysia` works without a backend for UI and end-to-end testing. A deployed request requires the fresh Convex backend, Google Places API (New), Better Auth/Apple configuration, and Turnstile secrets described in `.env.example`.

## Security boundary

- Browser code receives only `VITE_*` public origins.
- Google Places, Turnstile verification, Better Auth, cloud-AI provider keys, and rate-limit salts are server-only Convex environment variables.
- Optional cloud highlights are authenticated and per-request consented. The server receives only selected text notes and place names, validates structured cited-source output, and records provider/model/outcome receipts without storing prompts or responses.
- RevenueCat webhooks use a separate Convex-only `REVENUECAT_WEBHOOK_SIGNING_SECRET`. `/webhooks/revenuecat` verifies its raw-body HMAC and a five-minute delivery timestamp before recording an idempotent, redacted provider receipt. It never receives an entitlement decision from the client and never stores the raw event body.
- Public requests never reveal private Vazhi Moments, media, transcripts, or exact owner locations.

The prior experiment is preserved locally in `legacy-reference/` and intentionally excluded from Git.

## Convex rollout note

The supported production path is a fresh Convex deployment. If this code is instead deployed over an earlier Vazhi Ask-the-Way schema, the first authenticated owner request performs a self-service, idempotent claim of rows whose **verified current custom-JWT token identifier** matches the legacy owner field. It backfills Better Auth owner IDs and counters before owner reads/writes proceed. Do not remove the transitional legacy fields or indexes until every active legacy owner has signed in and the deployment’s migration audit is complete.
