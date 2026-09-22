# Vazhi release preflight

Run the release preflight in the platform environment where secrets are injected. It reports only missing variable names, never values:

```sh
VAZHI_ENVIRONMENT=preview npm run preflight:release
VAZHI_ENVIRONMENT=production npm run preflight:release -- --commerce
```

`--commerce` is required only when RevenueCat Web/Paddle is being enabled. Keep its production purchase-link and webhook signing secret out of the core launch until the RevenueCat project owner has completed the provider mapping.

For each preview and production environment, set `EDGE_INGRESS_SIGNING_SECRET` and `RATE_LIMIT_SALT` to the same values in both Convex and the Cloudflare Worker. Set `TURNSTILE_SECRET_KEY` in the Worker only; `VITE_TURNSTILE_SITE_KEY` is intentionally public and belongs in the web build configuration.

Do not run the preflight with copied secrets in a terminal command. Use the hosting provider's environment/secret injection instead.
