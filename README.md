# Vazhi Web

The public companion to Vazhi iOS. **Ask the Way** lets a traveller share one link, receive trusted place recommendations, and turn accepted suggestions into a private Path.

## Local setup

Use Node.js 22.12 or newer (`package.json` declares the minimum runtime).

```sh
npm install
cp .env.example .env.local
npm run dev
```

`/ask/demo-malaysia` works without a backend for UI and end-to-end testing. A deployed request requires the fresh Convex backend, Google Places API (New), Better Auth/Apple configuration, and Turnstile secrets described in `.env.example`.

## Security boundary

- Browser code receives only public `VITE_*` configuration: the Convex site URL and Turnstile site key.
- Cloudflare verifies Turnstile, derives an opaque rate key, and signs public writes/searches before forwarding them to Convex.
- Google Places and Better Auth secrets remain in Convex; Turnstile, ingress-signing, and rate-limit secrets remain in platform secret stores as described in `.env.example`.
- Public requests never reveal private Vazhi Moments, media, transcripts, or exact owner locations.
- `MODERATION_API_TOKEN` protects the operator-only `/api/admin/reports` queue. Use it only from a trusted terminal/workflow; never put it in `VITE_*`, a web page, or the iOS app. Decisions append audit records and takedowns immediately hide the guide.

The prior experiment is preserved locally in `legacy-reference/` and intentionally excluded from Git.
