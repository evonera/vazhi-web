# Unified owner authentication

## Implemented

Email + password (12-character minimum, verified email), Apple, Google, and Discord use one Better Auth identity. The website uses Better Auth UI React's provider and mutation/query hooks with Vazhi-styled accessible forms; it does not copy an unrelated default dashboard. Versions stay on the compatible Better Auth 1.6.33 / Better Auth UI 1.6.30 line because the current Convex adapter requires Better Auth below 1.7.

The Worker forwards `/api/auth/*`, `/api/owner/*`, and `/api/native/*` only to its configured Convex site. Cookies, OAuth callbacks, and owner HTTP calls stay on the website origin, avoiding Safari third-party cookie dependence. Responses are never cached. Provider credentials never enter browser bundles or the iOS app.

Account linking is explicit from `/requests` after sign-in. Implicit email-based provider linking is disabled. Different provider emails are permitted for explicit linking, including Apple relay addresses. Sign in with your existing method first and link the others; creating unrelated accounts does not merge existing journals.

## Native handoff

1. iOS opens `/sign-in` in `ASWebAuthenticationSession` with a random state and S256 PKCE challenge.
2. The owner signs in, sees their account identity, and explicitly taps **Continue to Vazhi**.
3. An authenticated, recent browser session creates a 90-second one-use grant. Only a code and state enter the fixed `com.evonera.vazhi://auth/callback` URL.
4. Native code validates the callback and exchanges the grant with its private verifier. Convex checks the same still-valid owner session before issuing a JWT.
5. The Better Auth session and JWT are stored in device-only Keychain, not UserDefaults, browser localStorage, or URLs. JWT renewal is silent; revoked sessions require explicit reconnect. Network failures retain the session for retry.

Grant consumption is atomic and scheduled expiry removes unused grants. Native authorization is limited per owner; exchanges also have a global safety cap. Local journal partition indexes contain no credentials and preserve legacy Apple partitions across linked-provider logins. Guest capture remains independent of sign-in.

Better Auth request limits use atomic Convex rate-limiter buckets rather than ephemeral process memory. Forwarded-IP headers are not trusted; the current limits are deliberately shared per endpoint (email login 20/minute, sign-up and reset 10/minute). This prevents header spoofing and retains no raw IPs. Before larger-scale production traffic, add trusted edge/WAF per-client controls and tune the shared limits; these are conservative beta abuse controls, not per-user quotas.

The shared native Convex client subscribes to `requests:inboxRevision`. Count, request state, and recommendation acceptance changes invalidate the owner Inbox, which refreshes via the existing owner repository/Places hydration boundary. Subscriptions cancel when the view exits or the account changes; HTTP pull-to-refresh remains available if live updates fail. This is live invalidation, not a new unbounded recommendation query.

## Provision before enabling hosted login

Configure each deployment separately. `SITE_URL` must be the matching Worker/custom-domain origin; `CONVEX_HTTP_URL` must target that same environment's Convex site. Do not mix preview users with production data.

| Method | Convex environment variables | Provider configuration |
| --- | --- | --- |
| Email/password | `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Verify sender domain; test verification/reset delivery |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Web OAuth client, authorized origin `SITE_URL`, callback `SITE_URL/api/auth/callback/google` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | OAuth redirect `SITE_URL/api/auth/callback/discord` |
| Apple web | `APPLE_SERVICE_ID`, `APPLE_CLIENT_SECRET`, `APPLE_BUNDLE_ID` | Apple Developer service/domain configuration and callback `SITE_URL/api/auth/callback/apple`; rotate the signed client secret before expiry |

Existing `BETTER_AUTH_SECRET`, `RATE_LIMIT_SALT`, Places/Routes keys, and Worker ingress secrets remain server configuration. Maps API keys are not Google OAuth credentials. `/api/owner/auth-capabilities` returns booleans only; missing methods are visibly unavailable rather than launching broken OAuth.

## Verification and outstanding gates

- Unit coverage: verifier binding, single use/replay, expiry, concurrent grant exchange, real Better Auth JWT issuance, email verification/password/reset handling, durable concurrent auth rate limits, proxy cookie/redirect forwarding, rejected cross-origin requests, and generic errors.
- Playwright: 320px layout, disabled-provider messaging, email contract/dashboard transition, and explicit native grant confirmation. Auth/provider responses in these tests are fixtures, not live OAuth proof.
- iOS: legacy decoding, silent renewal/coalescing, revoked/transient/wrong-owner outcomes, linked-provider journal partition preservation, and Apple revocation gating.
- Local whole-tree build is affected by unrelated untracked `convex/imports.ts` and `convex/crons.ts`. The tracked application plus this change is validated in a temporary source snapshot without those files; they are not deleted or staged here.
- Still required: provision credentials, deploy this branch, verify real email/OAuth and account linking on both environments, test Safari cookies and native browser return on a physical iPhone, then run sign-in → Journey → public submission → live Inbox → accept → Path/route against the deployment.
- This change is not a claim of production authentication or completed end-to-end hosted testing. Apple enrollment remains external setup.

References: [Convex Better Auth](https://labs.convex.dev/better-auth), [Better Auth UI guidance](https://better-auth-ui.com/docs/agent-skills), [Apple](https://better-auth.com/docs/authentication/apple), [Google](https://better-auth.com/docs/authentication/google), [Discord](https://better-auth.com/docs/authentication/discord).
