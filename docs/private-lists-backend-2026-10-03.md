# Private Lists backend release evidence

Implemented on `codex/release-fixes-place-lists` from main `b8c3189`; the original working copies were preserved. The matching native implementation is in the iOS repository's branch with the same name.

Review stages:

1. Replace coordinate-only recommendation recovery with named unresolved suggestions that the owner must locate before routing. Old clients are excluded through the existing minimum-client-version contract. Route-limit wording is temporary, without quota/cache increases.
2. Add private SavedPlace/List/membership records, owner-authenticated no-store HTTP endpoints, field/provider validation, expected revisions, idempotent operation receipts, paginated deltas and deletion tombstones. Deleted parent dependencies return reviewable conflicts rather than blocking all sync. Account purge includes all five new tables.
3. Align privacy text with private sync, device-local photos/schedules/receipts, local confirmed CSV/KML import, provider-safe navigation, and narrow calendar export. No website Lists workspace is added.

Verification on 3 October 2026:

- Locked `npm ci` repaired the missing workerd executable; lockfile unchanged. Four dependency advisories remain (three moderate, one high), needing deliberate triage.
- 123 backend tests / 30 files passed. Both TypeScript checks and Vite client/Worker build passed.
- Updated browser suite passed all 24 tests using one worker. A concurrent high-worker rerun hit eight page/action timeouts; only the complete successful rerun is accepted as final evidence.
- Convex production dry run proposed additive private-place indexes, deleting none. Worker production dry run passed. These are not production deploys.
- No production environment mutation, merge or App Store submission occurred. A development Convex codegen run uploaded development functions earlier; do not confuse that with production rollout.

Deploy reviewed additive Convex code first, then the matching Worker/client. Gate the rollout on the native migration/UI results, live two-device owner isolation/conflicts/deletion, physical integrations and billing tests. Production has no `APPLE_NATIVE_CLIENT_SECRET`; automatic native Apple revocation still needs separate configuration/live proof and the manual-disconnect fallback remains. Demo reviewer credentials/content and Apple's beta rejection are separate unfinished requirements.
