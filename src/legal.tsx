const updated = '25 September 2026'

export function PrivacyContent() {
  return <div className="legal-content">
    <p className="legal-updated">Updated {updated}</p>
    <p>Vazhi is a private travel journal with optional sharing. This notice describes the iPhone app and this website. Contact <a href="mailto:hello@vazhi.app">hello@vazhi.app</a> about privacy or a data request.</p>
    <h2>What stays on your device</h2>
    <p>Journeys, Moments, photos, and voice recordings start in the app's local storage. You can capture without an account. Current cloud sync sends selected Journey and Moment text, place identifiers or coordinates, and media type indicators; it does not upload photo or audio files. If you sign in, synced records are associated with your account.</p>
    <h2>What you choose to share</h2>
    <p>An Ask the Way link displays the question and destination to anyone with the link. Recommendations submitted through it, including a contributor's chosen name or handle, place, note, and reference link, are shown to the request owner. A contributor can choose to submit anonymously. A public profile or guide appears only after its owner explicitly publishes it; published guide text and approved stops can be seen by anyone with the link or, for public profiles, by visitors to the profile. Do not include private addresses or sensitive details in content you share.</p>
    <h2>Services used to provide Vazhi</h2>
    <p>Sign in with Apple supports account access. Convex stores account data and the cloud records you choose to sync or publish. Google Maps Platform handles place lookup and routing; searches and route stops are sent to Google when you use those features. Cloudflare serves the website and protects public forms with Turnstile and rate limiting. RevenueCat processes subscription status if you use a subscription. If you explicitly opt into cloud AI, selected source text is sent through Vazhi's server to the model provider for that request. These services may process technical request data needed to operate and protect the service.</p>
    <h2>Storage, control, and contact</h2>
    <p>Local content can be removed from the app. Shared links can be closed, and published guides can be withdrawn. Closing a link stops new recommendations; it does not automatically erase records already received. To delete your cloud account and its associated content, use Profile → Settings → Delete cloud account in the iPhone app. A fresh Apple sign-in confirms your identity. Cloud cleanup runs after deletion; local journals remain as guest content on your device. Apple subscriptions must be managed separately. For access requests or help, email <a href="mailto:hello@vazhi.app?subject=Vazhi%20privacy%20request">hello@vazhi.app</a>.</p>
    <p>Vazhi does not sell personal data or use advertising trackers. The app does not request background location. Location is used when you choose to attach or select a place.</p>
  </div>
}

export function TermsContent() {
  return <div className="legal-content">
    <p className="legal-updated">Updated {updated}</p>
    <p>Vazhi helps you record places, ask for recommendations, and assemble travel paths. You are responsible for what you choose to capture, submit, or publish.</p>
    <h2>Shared content</h2>
    <p>Only share content you have the right to use. Do not publish another person's private location, impersonate someone, or submit unlawful, abusive, or misleading material. Shared Ask the Way links expose the question and destination; published guides and public profiles are visible as described in our <a href="/privacy">Privacy notice</a>. We may remove reported content or restrict misuse.</p>
    <h2>Travel information</h2>
    <p>Recommendations, AI suggestions, place information, and routes can be incomplete or outdated. Check opening hours, access, safety conditions, and route suitability independently before you travel. Walking, cycling, and two-wheeler routes may be incomplete.</p>
    <h2>Subscriptions</h2>
    <p>Optional iPhone subscriptions are purchased and managed through Apple's App Store. The price, duration, renewal terms, and available trial are shown in the purchase flow. Manage or cancel an active subscription through your Apple account; use Restore Purchases in the app to recover access.</p>
    <h2>Availability and changes</h2>
    <p>Features may change or be unavailable during outages. We may update these terms as the service develops and will post the current version here. Contact <a href="mailto:hello@vazhi.app">hello@vazhi.app</a> with a question about the service.</p>
  </div>
}

export function ReportContent() {
  return <div className="legal-content">
    <p>To report a published guide, open that guide and select <strong>Report this guide</strong>. The form lets you flag a private or sensitive location, impersonation, unsafe information, or another concern. Reports go to our moderation queue and are not shown on the guide.</p>
    <p>For an Ask the Way link or any other urgent content concern, email <a href="mailto:hello@vazhi.app?subject=Vazhi%20content%20report">hello@vazhi.app</a> with the link and a short description. Do not include more personal information than needed to explain the issue.</p>
  </div>
}
