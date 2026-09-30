# Website release design — 1 October 2026

## Scope and design thesis

Vazhi's public website should feel like the same private, photo-led travel journal as the iPhone app. It introduces Capture, Ask the Way, and editable Itineraries; public recommendation forms stay lightweight and do not require an account.

The review uses Apple-design foundations for readable text, semantic color, adaptable layout, feedback, and privacy. Native-only platform navigation conventions are not imposed on the website. The latest app source for comparison is `Vazhi/DesignSystem/Theme.swift` on the merged itinerary branch, not the older original Xcode checkout.

## Confirmed problems corrected

- The black/orange/rainbow campaign and remotely downloaded Manrope/DM Mono fonts conflicted with the app's warm paper surfaces and editorial serif/system sans typography. CSS now uses local system font stacks, warm light surfaces, adaptive dark surfaces, and the app's saturated pink action family. No Apple font binaries are redistributed.
- Page headings were very large, tightly tracked and frequently below a readable line-height. Marketing headings now use a restrained fluid scale; form/detail titles stay around 30–44 CSS px, normal body/input text 16–17 CSS px. Relative units preserve browser text scaling.
- Compact primary navigation was hidden. It now wraps into a second row with at least 44px targets, keeping Product, Safety, Privacy, and Contact reachable.
- Continuous marquee/bobbing animation added motion without helping a task. These decorations were removed; hover/press feedback remains brief, with reduced-motion, increased-contrast, and forced-colors handling.
- Website feature copy still called the Itinerary a Path and overstated blanket privacy. User-facing copy now distinguishes private itineraries from deliberately published guides.
- Web sign-in presented disabled, unconfigured providers and developer configuration notes. Only available methods are shown; a plain recovery message appears when none are available. Native PKCE handoff and callback validation are unchanged.
- A failed guide report replaced the already-loaded guide with an unavailable page. Report errors now remain beside the report form, retain the selected reason/details, allow retry/cancel, and guard duplicate in-flight submissions.
- The privacy notice omitted Modal video processing and temporary uploaded originals. It now distinguishes journal media from optional video uploads, names Modal, Convex, Google Places, RevenueCat, and optional OpenAI highlights, and explains cleanup and already-running processing after deletion. The copy is grounded in the audited processing/deletion code, not a claim of instant cancellation or a fixed cleanup SLA.

## Shared tokens and contrast

| Role | Light | Dark | Contrast tested |
| --- | --- | --- | --- |
| Canvas | `#fbf8f5` | `#121114` | — |
| Card | `#ffffff` | `#1c1b1f` | — |
| Body text | `#201d22` | `#f6f1f5` | 15.75:1 / 16.86:1 against canvas |
| Supporting text | `#625e63` | `#c9c4cb` | 6.36:1 / 9.99:1 against card |
| Link/selection | `#b50055` | `#ff96bf` | 6.78:1 / 8.46:1 against card |
| Action / label | `#c40a5b` / white | `#ff84b4` / `#121114` | 5.93:1 / 8.25:1 |
| Input border | `#827a80` | `#928792` | 3.93:1 / 5.47:1 against input canvas |

Ratios are calculated from the actual CSS tokens. Disabled controls intentionally use a subdued state; the test does not claim the disabled opacity has the same contrast as an enabled action.

Fonts: local `ui-serif` with Georgia/Cambria fallbacks for editorial headings; `-apple-system`/BlinkMacSystemFont/Segoe UI/system-ui for body and controls. Exact cross-platform glyph shapes vary; typography roles and hierarchy match the app without distributing proprietary fonts.

## Verification

`npx tsc --noEmit` passed. `npx playwright test --workers=1` passed all 24 tests (24.7 seconds), covering public recommendation submit/retry/idempotency, manual place fallback, closed/unavailable links, launch/legal routes, web auth capability filtering, email login fixtures, native PKCE handoff fixtures, public guides and report recovery.

Additional design tests cover light/dark token contrast, input text size/44px targets, keyboard focus, 320/390/768/1440px widths, reduced motion, visible compact navigation, and a successful recommendation submission with 200% root text size. Screenshot capture is part of the existing E2E harness.

Evidence paths:

- `/tmp/vazhi-website-release-home-mobile-light-viewport.png`
- `/tmp/vazhi-website-release-home-mobile-dark-viewport.png`
- `/tmp/vazhi-website-release-home-desktop-light-viewport.png`
- `/tmp/vazhi-website-release-home-desktop-dark-viewport.png`
- `/tmp/vazhi-website-release-home-mobile-light.png` (full page; dark equivalent available)
- `/tmp/vazhi-website-release-home-desktop-light.png` (full page; dark equivalent available)
- `/tmp/vazhi-website-release-ask-mobile-light.png` (dark equivalent available)
- `/tmp/vazhi-website-release-privacy-mobile-light.png` (dark equivalent available)

These tests use controlled API fixtures and built-in demo recommendations. They do not prove production OAuth credentials, live Google searches, real subscription purchases, moderation operations, or the deployed website revision. The website has not been deployed by this change. The launch/download page remains honest about the app not yet being released; replace its launch destination with the real App Store link after publication.

## References used

Read from the Apple-design skill's HIG sources:

- `accessibility.md` › Vision/Mobility: scalable text, contrast, keyboard operation, comfortable targets.
- `layout.md` › Adaptability: preserve hierarchy and test the smallest/largest layouts.
- `typography.md` › Ensuring legibility/Conveying hierarchy: restrained type families, readable sizes, text scaling.
- `color.md` › Best practices/Inclusive color and `dark-mode.md` › Best practices: semantic roles and both appearances.
- `buttons.md` › Style/Content: primary action hierarchy and clear labels.
- `writing.md` › Best practices: consistent naming, actionable recovery, no internal jargon.
- `privacy.md` › Best practices: transparent data use and specific user control.

The warm-paper travel-journal treatment and preserved local travel examples are design judgment, rooted in the existing app and product rather than an unrelated campaign aesthetic.
