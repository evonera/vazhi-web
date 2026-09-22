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
- Public requests never reveal private Vazhi Moments, media, transcripts, or exact owner locations.

The prior experiment is preserved locally in `legacy-reference/` and intentionally excluded from Git.
