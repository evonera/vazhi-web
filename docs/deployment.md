# Vazhi release preflight

Run the release preflight separately in each deployment target's secret-injected environment. It reports only missing variable names, never values:

```sh
npm run preflight:release -- --target=convex
npm run preflight:release -- --target=worker
npm run preflight:release -- --target=convex --commerce
```

Set `VAZHI_ENVIRONMENT` to `preview` or `production` through the deployment provider. `--commerce` is required only when RevenueCat Web/Paddle is being enabled, and applies to the Convex target where those values are consumed. Keep its production purchase-link and webhook signing secret out of the core launch until the RevenueCat project owner has completed the provider mapping.

For each preview and production environment, set `EDGE_INGRESS_SIGNING_SECRET` and `RATE_LIMIT_SALT` to the same values in both Convex and the Cloudflare Worker. Set `TURNSTILE_SECRET_KEY` in the Worker only; `VITE_TURNSTILE_SITE_KEY` is intentionally public and belongs in the web build configuration.

Do not run the preflight with copied secrets in a terminal command. Use the hosting provider's environment/secret injection instead.
