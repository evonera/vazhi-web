import { defineApp } from 'convex/server'
import betterAuth from '@convex-dev/better-auth/convex.config.js'
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js'
import workpool from '@convex-dev/workpool/convex.config.js'

const app = defineApp()
app.use(betterAuth)
app.use(rateLimiter)
// One deliberately low-concurrency queue for idempotent work only. Interactive
// place search and Path creation remain direct requests.
app.use(workpool, { name: 'backgroundWorkpool' })

export default app
