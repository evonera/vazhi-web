# Private Lists backend release evidence

Implemented on `codex/release-fixes-place-lists` from main `b8c3189`; the original working copies were preserved. The matching native implementation is in the iOS repository's branch with the same name.

Review stages:

1. Replace coordinate-only recommendation recovery with named unresolved suggestions that the owner must locate before routing. Old clients are excluded through the existing minimum-client-version contract. Route-limit wording is temporary, without quota/cache increases.
2. Add private SavedPlace/List/membership records, owner-authenticated no-store HTTP endpoints, field/provider validation, expected revisions, idempotent operation receipts, paginated deltas and deletion tombstones. Deleted parent dependencies return reviewable conflicts rather than blocking all sync. Account purge includes all five new tables.
3. Align privacy text with private sync, device-local photos/schedules/receipts, local confirmed CSV/KML import, provider-safe navigation, and narrow calendar export. Preserve `/legal/privacy` and `/legal/terms` aliases (including trailing slash), which previously fell through to the homepage. No website Lists workspace is added.

Verification on 3 October 2026:

- Locked `npm ci` repaired the missing workerd executable. A later scoped Miniflare override updates only Undici 7.29.0 → 7.29.1 in the lockfile, clearing the four development-tooling advisories. Full `npm audit` and `npm audit --omit=dev` now report zero advisories. This patch follows the [upstream security release](https://github.com/nodejs/undici/releases/tag/v7.29.1); it is not a broad dependency upgrade or a finding that all security risks are eliminated.
- 123 backend tests / 30 files passed. Both TypeScript checks and Vite client/Worker build passed.
- Final browser suite passed all 25 tests using one worker and its configured server, including the legal aliases. Earlier high-worker timeouts and a preview-server run without the test Turnstile key are not passing evidence. Ego browser checks independently verified mobile privacy layout, legal aliases and the demo's unlocated recommendation flow; no live recommendation was submitted.
- Matching final native suite passed 293 unit tests and 22 UI tests, with one on-device-model availability skip. Native runtime audio/keyboard diagnostics remain documented in the iOS release evidence.
- Convex production dry run proposed additive private-place indexes, deleting none. Worker production dry run passed. These are not production deploys.
- No production environment mutation, merge or App Store submission occurred. A development Convex codegen run uploaded development functions earlier; do not confuse that with production rollout.

Deploy reviewed additive Convex code first, then the matching Worker/client. Gate the rollout on the native migration/UI results, live two-device owner isolation/conflicts/deletion, physical integrations and billing tests. At the time of the 3 October audit, production had no `APPLE_NATIVE_CLIENT_SECRET`. The authorized 4 October follow-up configured native credentials in preview and production (expiry 2 January 2027); see `release-backend-readiness.md` for exact evidence and renewal steps. On 5 October the credential endpoint returned 401 (authentication required), not 404, on both deployments. Live native Apple revocation is still unproven. The manual-disconnect fallback remains for legacy/failure cases. Demo reviewer credentials/content and Apple's beta rejection are separate unfinished requirements.

## Release checkout reconciliation — 5 October 2026

- Fresh verification passed 123 backend tests, both TypeScript checks, the production client/Worker build, and all 25 Playwright browser tests. The native Apple credential helper passed its three Node tests.
- Production and preview `/api/owner/auth-capabilities` each returned 200 with email, Google and Discord enabled. The `apple: false` capability concerns browser Apple OAuth, not the independent native Apple token flow. Provider secrets were not replaced or printed.
- Production Convex dry run completed with eight additive private-place indexes and no deleted indexes. The private-place HTTP route was still 404 before rollout; a dry run is not a deployment.
- The native PR's older green-suite summary is not final release evidence: its 4 October follow-up documented 298 unit passes and two UI failures. See the matching native release notes for the current rerun; do not claim every native gate is green from this document.

Final logs are under `/Users/shakthi/Library/Logs/VazhiListsValidation/`: `backend-tests-final.log`, `web-build-final.log`, `browser-e2e-configured-final.log`, `locked-install-security-patch.log`, and `worker-production-final-dry-run.log`. Convex's latest interactive dry run also completed with additive indexes and no deletes; its CLI confirmation did not perform a production deploy.
