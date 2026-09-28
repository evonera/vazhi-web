import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Uploaded clips cannot linger if a worker or client disappears mid-job.
crons.interval('prune stale reel imports', { hours: 1 }, internal.imports.pruneStale, {})

export default crons
