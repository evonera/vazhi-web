# Backend release-readiness verification

Audit date: 1 October 2026. This is a code/test report, not evidence of a production deployment or an App Store approval guarantee.

## Confirmed fixes

1. **Deletion recovery checks the real auth component.** Better Auth stores users in its Convex component. The previous recovery check looked for a root-table user and could activate a product-data purge when auth deletion had failed. Recovery now calls `authComponent.getAnyUserById`. If the user still exists, it removes the pending deletion job without purging their journal. If a slow auth deletion subsequently succeeds, its activation recreates the cleanup job only after confirming that the real auth user is absent.
2. **Deletion fences asynchronous writes.** Authenticated HTTP requests can capture an owner before a long upload, route computation or other work completes. Reel creation/upload commits, dispatch/callbacks/place resolution, public recommendation submission, profile/listing/request writes, route snapshot commits and AI usage recording now recheck deletion state at the committing transaction. Reel operations also verify the actual owner still exists after the deletion job itself has been removed. Uploaded media rejected at commit is cleaned up by the existing HTTP handler.
3. **Reel media was already included in account deletion.** The imported audit's claim that `reelImports` was omitted is stale on current `main`. The purge deletes the import's Convex Storage object as well as its private record. Regression tests verify owner media is removed and another account's media survives. Late callbacks cannot recreate purged product records.
4. **Native Apple revocation credentials are now retained securely.** After the existing Better Auth Apple sign-in succeeds, the native app optionally sends its transient authorization code and identity token to `POST /api/native/apple/credentials`, using its existing bearer session. This endpoint does not create a sign-in session or accept browser cookies/origins. It cryptographically verifies Apple's JWKS signature, issuer, native audience and expiry, exchanges the code, verifies the returned identity has the same subject, and matches that subject to the signed-in user's linked Apple account before saving an encrypted refresh token. The private table is exposed only through internal functions and is purged on account deletion. Authorization codes are excluded from native persisted user encoding.
5. **Deletion attempts Apple revocation without trapping the user's data.** The account-deletion hook uses the encrypted refresh token with Apple's `/auth/revoke` endpoint before auth removal. Missing legacy credentials, configuration or provider/network failures do not prevent the requested account deletion. The native completion message directs Apple users to remove Vazhi from their Apple Account's Sign in with Apple settings if it remains listed. This follows Apple's documented fallback for accounts whose tokens cannot be revoked programmatically.
6. **Cloud-AI disclosure has an enforced provider identity.** Cloud generation accepts only `https://api.openai.com/v1/chat/completions`, not an arbitrary compatible endpoint, and refuses redirects. The native/web consent may therefore accurately name OpenAI. User data is not sent to a substituted endpoint through the configurable URL.
7. **Late native credential results are identity-scoped.** After waiting for Apple credential state or cloud name-repair renewal, the native store rechecks both owner ID and sign-in method before applying revocation or reconciling subscription identity. This also protects a browser-provider switch on the same account from an old Apple callback. Delayed-response tests cover both provider and account switches.
8. **Modal's failure cleanup is initialized before callbacks.** A failed initial processing callback previously left `audio_path` uninitialized, so `finally` could raise `UnboundLocalError` and mask the actual callback failure. Initialization now precedes the `try`; a mocked local worker test verifies the failure callback and cleanup complete without invoking remote inference.

## Verification

- `npm test -- --maxWorkers=1 --testTimeout=30000`: 29 test files, 117 tests passed after the UGC moderation changes. `npm run build` passed (root TypeScript, Convex TypeScript, Vite client and Worker). `git diff --check` passed. This is local test/build evidence only, not a production deploy.
- `npm run build`: root TypeScript, Convex TypeScript and Vite client/worker builds passed.
- `python -m unittest discover -s modal/tests -v`: 11 tests passed using a disposable Python 3.12 environment with Modal/FastAPI/Pillow dependencies. The callback regression uses Modal's documented `Function.local()` method; no Modal deployment, remote inference or GPU/model download was performed. The SDK's expected local-volume warning is not proof of a remote test.
- New Apple tests use locally signed test JWTs and a stub Apple JWKS/token/revoke service. They cover malformed/signature/audience/expiry/subject failures, signed-in ownership, cookie/origin rejection, encrypted storage and purge, absent native configuration, and failed revocation without failed account deletion. They do not represent a real Apple transaction.
- Deletion recovery uses component-backed Better Auth fixtures, including the regression where a still-live account must not be purged. Import tests exercise deleting-owner and fully deleted-owner fences, late callbacks, dispatch/place resolution, uploads and owned media cleanup.
- Native tests additionally verify the one-time authorization code is not persisted, and optional credential retention failure does not break a successful Apple sign-in. Native build/test results must be recorded by the iOS release verification, not inferred from the backend suite.
- The repository's existing Vitest runtime remains Node. These tests use `convex-test`; no deployment, environment mutation or dependency upgrade was performed as part of this audit.
- New moderation tests verify signed-cookie integrity/identity replacement, cookie issuance and cache controls, report hiding and operator takedown, block suppression of old and future recommendations, and account-deletion cleanup of block records. Browser-cookie deletion/evasion and operator response-time operations cannot be proven by unit tests.

## Apple setup and live proof still required

Configure on the intended Convex deployment, without placing private values in source control:

- `APPLE_BUNDLE_ID`: the native app's registered bundle ID, currently `com.evonera.vazhi`.
- `APPLE_NATIVE_CLIENT_SECRET`: a Sign in with Apple client-secret JWT whose `sub` is that bundle ID. It is **not** a reuse of a web Services ID client secret. Generate and rotate it using the authorized Apple Sign in key; Apple client-secret JWTs expire and require rotation.
- `BETTER_AUTH_SECRET`: the deployment's existing server secret, also used to encrypt/decrypt the revocation credential. Rotation requires a deliberate credential migration or fresh Apple sign-ins; do not assume previously encrypted tokens survive replacing it.

Deploy the reviewed schema/functions and native changes together, then verify with a fresh physical-device Apple sign-in that the optional endpoint returns `stored: true`. On a dedicated test account, delete the account and verify Apple consent is revoked, the Better Auth account and product rows are purged, and attached media becomes unavailable. Recheck interrupted deletion and callback delivery during deletion. Do not delete a real user's account for this test. Old accounts without retained credentials still have the manual disconnection guidance.

Web Apple sign-in is currently unavailable in the observed production capabilities. This patch captures **native** Apple credentials; enabling web Apple sign-in later requires equivalent web-provider token retention/revocation verification, rather than assuming the native secret applies to a web Services ID.

## Actual media handling and retention

- A user-selected fallback video is temporarily stored in Convex Storage; Modal CPU workers download it and extract audio/frames. Modal GPU inference runs the self-hosted Qwen models; candidate names may then be resolved with Google Places.
- The original Convex video is deleted on terminal processing/failure callbacks, owner import removal and account purge. Hourly abandoned-job cleanup applies a 24-hour cutoff to `awaiting_upload` and a two-hour cutoff to queued/processing/resolving imports. These are cleanup cutoffs, **not** an exact deletion SLA.
- Modal source videos/frames are scoped to temporary CPU directories; GPU audio is removed in `finally`. The persistent Modal model-cache volume holds model weights, not original videos.
- Account deletion does **not** immediately cancel an already-running Modal invocation or remove bytes already in its invocation payload. Such work may finish, while owner-liveness/deletion checks prevent late callbacks from recreating account data. Privacy text must describe this honestly.

## Remaining release blockers / separate proof

1. **UGC report and block controls are implemented, but the safety loop is not yet proven complete.** Recommendation owners can report and hide a reply, block its signed pseudonymous browser identity, and the protected moderation queue can take down a flagged recommendation. Future submissions from that identity are ignored for that owner; the identity is stored only as an owner-scoped hash. Account deletion removes block rows and recommendation reports. The public form states the moderation policy, and privacy copy explains that clearing browser data or switching browsers can evade a block. Automated objectionable-content filtering and an operational response-time commitment remain absent, so do not claim complete Guideline 1.2 compliance until those controls and operator procedures are in place and tested. A browser cookie is not verified real-world identity.
2. **Live Apple revocation/configuration proof** as described above has not been performed. A passing stub suite is not that proof.
3. **Production deployment and environment parity** remain to be verified after review. No deploy or environment changes were authorized for this subtask.
4. **RevenueCat sandbox/StoreKit proof, real-device permissions/share-extension tests, privacy labels, reviewer access and production agreements** belong to the broader release checklist. This backend patch does not establish that billing or the whole app is production-ready.

Primary references:

- [Apple TN3194: account deletion and Sign in with Apple token revocation](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
- [Apple Sign in with Apple REST token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)
- [Better Auth Apple provider](https://www.better-auth.com/docs/authentication/apple)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
