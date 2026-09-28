import { ConvexError, v } from 'convex/values'
import { RateLimiter, HOUR } from '@convex-dev/rate-limiter'
import { components, internal } from './_generated/api'
import { MutationCtx, internalAction, internalMutation, internalQuery } from './_generated/server'
import { MAX_REEL_VIDEO_BYTES } from '../src/lib/reelImportHTTP'

const importLimiter = new RateLimiter(components.rateLimiter, {
  ownerReelImport: { kind: 'token bucket', rate: 5, period: 24 * HOUR, capacity: 5 },
  ownerReelUploadAttempt: { kind: 'token bucket', rate: 10, period: 24 * HOUR, capacity: 10 },
})
const MAX_UPLOAD_ATTEMPTS_PER_IMPORT = 2

function canonicalInstagramURL(raw: string) {
  let url: URL
  try { url = new URL(raw) } catch { throw new ConvexError('Paste a valid Instagram reel link.') }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!['instagram.com', 'm.instagram.com'].includes(host) || url.protocol !== 'https:' || url.username || url.password) {
    throw new ConvexError('Only public Instagram links are supported.')
  }
  const match = url.pathname.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]{5,32})\/?$/)
  if (!match) throw new ConvexError('Paste a public Instagram reel link.')
  return `https://www.instagram.com/reel/${match[1]}/`
}

function validIdempotencyKey(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function applyOwnerLimit(ctx: MutationCtx, ownerAuthUserId: string) {
  const { ok } = await importLimiter.limit(ctx, 'ownerReelImport', { key: ownerAuthUserId, throws: false })
  if (!ok) throw new ConvexError('You have reached the reel import limit. Try again tomorrow.')
}

async function applyUploadAttemptLimit(ctx: MutationCtx, ownerAuthUserId: string) {
  const { ok } = await importLimiter.limit(ctx, 'ownerReelUploadAttempt', { key: ownerAuthUserId, throws: false })
  if (!ok) throw new ConvexError('You have reached the video upload limit. Try again tomorrow.')
}

export const createLinkForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), idempotencyKey: v.string(), sourceURL: v.string() },
  handler: async (ctx, args) => {
    if (!validIdempotencyKey(args.idempotencyKey)) throw new ConvexError('Invalid import request.')
    const sourceURL = canonicalInstagramURL(args.sourceURL)
    const existing = await ctx.db.query('reelImports')
      .withIndex('by_ownerAuthUserId_and_idempotencyKey', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('idempotencyKey', args.idempotencyKey))
      .unique()
    if (existing) return { id: existing._id, status: existing.status, created: false }
    await applyOwnerLimit(ctx, args.ownerAuthUserId)
    const now = Date.now()
    const id = await ctx.db.insert('reelImports', {
      ownerAuthUserId: args.ownerAuthUserId,
      idempotencyKey: args.idempotencyKey,
      sourceURL,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.imports.dispatch, { importId: id })
    return { id, status: 'queued' as const, created: true }
  },
})

// A reservation precedes the authenticated HTTP body upload. The video is
// stored and attached in that same HTTP action; no unbounded Convex upload URL
// is ever exposed to the client.
export const reserveVideoUploadForOwner = internalMutation({
  args: {
    ownerAuthUserId: v.string(),
    idempotencyKey: v.optional(v.string()),
    sourceURL: v.optional(v.string()),
    importId: v.optional(v.id('reelImports')),
  },
  handler: async (ctx, args) => {
    if (Boolean(args.importId) === Boolean(args.idempotencyKey)) throw new ConvexError('Invalid upload request.')
    if (args.idempotencyKey && !validIdempotencyKey(args.idempotencyKey)) throw new ConvexError('Invalid import request.')
    const sourceURL = args.sourceURL ? canonicalInstagramURL(args.sourceURL) : undefined
    const existing = args.importId
      ? await ctx.db.get(args.importId)
      : await ctx.db.query('reelImports')
        .withIndex('by_ownerAuthUserId_and_idempotencyKey', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId).eq('idempotencyKey', args.idempotencyKey!))
        .unique()
    if (existing) {
      if (existing.ownerAuthUserId !== args.ownerAuthUserId) return null
      if (!['needs_media', 'awaiting_upload', 'failed'].includes(existing.status)) {
        return { id: existing._id, status: existing.status, upload: false, created: false }
      }
      if ((existing.uploadAttemptCount ?? 0) >= MAX_UPLOAD_ATTEMPTS_PER_IMPORT) {
        throw new ConvexError('Start a new import to retry this video upload.')
      }
      await applyUploadAttemptLimit(ctx, args.ownerAuthUserId)
      await ctx.db.patch(existing._id, {
        status: 'awaiting_upload', failureCode: undefined,
        uploadAttemptCount: (existing.uploadAttemptCount ?? 0) + 1,
        updatedAt: Date.now(),
      })
      return { id: existing._id, status: 'awaiting_upload' as const, upload: true, created: false }
    }
    if (args.importId || !args.idempotencyKey) return null
    await applyOwnerLimit(ctx, args.ownerAuthUserId)
    await applyUploadAttemptLimit(ctx, args.ownerAuthUserId)
    const now = Date.now()
    const id = await ctx.db.insert('reelImports', {
      ownerAuthUserId: args.ownerAuthUserId,
      idempotencyKey: args.idempotencyKey,
      sourceURL,
      status: 'awaiting_upload',
      uploadAttemptCount: 1,
      createdAt: now,
      updatedAt: now,
    })
    return { id, status: 'awaiting_upload' as const, upload: true, created: true }
  },
})

export const completeUploadForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), importId: v.id('reelImports'), storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.ownerAuthUserId !== args.ownerAuthUserId) return null
    if (record.status !== 'awaiting_upload') throw new ConvexError('This import is no longer waiting for a video.')
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    const allowedTypes = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v'])
    if (!metadata || metadata.size > MAX_REEL_VIDEO_BYTES || !metadata.contentType || !allowedTypes.has(metadata.contentType)) {
      throw new ConvexError('Choose a video under 20 MB in MP4 or QuickTime format.')
    }
    const now = Date.now()
    await ctx.db.patch(record._id, {
      mediaStorageId: args.storageId, status: 'queued',
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.imports.dispatch, { importId: record._id })
    return { id: record._id, status: 'queued' as const }
  },
})

export const dispatchPayload = internalQuery({
  args: { importId: v.id('reelImports') },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.status !== 'queued') return null
    const mediaURL = record.mediaStorageId ? await ctx.storage.getUrl(record.mediaStorageId) : null
    // An uploaded video supersedes the original link for worker input. Keep
    // sourceURL on the record for the owner's import history, but never send
    // both inputs: the worker intentionally rejects ambiguous media sources.
    return { id: String(record._id), sourceURL: record.mediaStorageId ? null : record.sourceURL ?? null, mediaURL, callbackURL: `${process.env.CONVEX_SITE_URL}/api/internal/imports/callback` }
  },
})

export const markDispatched = internalMutation({
  args: { importId: v.id('reelImports'), modalCallId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.status !== 'queued') return null
    await ctx.db.patch(record._id, { status: 'processing', updatedAt: Date.now() })
    return null
  },
})

export const markDispatchFailed = internalMutation({
  args: { importId: v.id('reelImports'), failureCode: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.status !== 'queued') return null
    if (record.mediaStorageId) await ctx.storage.delete(record.mediaStorageId)
    await ctx.db.patch(record._id, {
      status: record.sourceURL && !record.mediaStorageId ? 'needs_media' : 'failed',
      failureCode: args.failureCode,
      mediaStorageId: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const dispatch = internalAction({
  args: { importId: v.id('reelImports') },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.imports.dispatchPayload, { importId: args.importId })
    if (!payload) return null
    const endpoint = process.env.MODAL_REEL_IMPORT_URL
    const token = process.env.MODAL_REEL_IMPORT_TOKEN
    if (payload.sourceURL && !payload.mediaURL && process.env.REEL_URL_IMPORT_ENABLED !== 'true') {
      await ctx.runMutation(internal.imports.markDispatchFailed, { importId: args.importId, failureCode: 'url_import_not_enabled' })
      return null
    }
    if (!endpoint || !token || !payload.callbackURL.startsWith('https://')) {
      await ctx.runMutation(internal.imports.markDispatchFailed, { importId: args.importId, failureCode: 'worker_unavailable' })
      return null
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ importId: payload.id, sourceURL: payload.sourceURL, mediaURL: payload.mediaURL }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`Modal returned ${response.status}`)
      const body = await response.json() as { callId?: unknown }
      await ctx.runMutation(internal.imports.markDispatched, {
        importId: args.importId,
        modalCallId: typeof body.callId === 'string' ? body.callId : undefined,
      })
    } catch {
      await ctx.runMutation(internal.imports.markDispatchFailed, { importId: args.importId, failureCode: 'worker_unavailable' })
    }
    return null
  },
})

export const acceptCallback = internalMutation({
  args: {
    importId: v.id('reelImports'),
    status: v.union(v.literal('processing'), v.literal('needs_media'), v.literal('failed'), v.literal('completed')),
    failureCode: v.optional(v.string()),
    mediaSignals: v.optional(v.object({
      audioTrackDetected: v.boolean(),
      audioHasEnergy: v.boolean(),
      audioTranscriptDetected: v.boolean(),
      framesAnalyzed: v.number(),
      visibleTextDetected: v.boolean(),
    })),
    warningCodes: v.optional(v.array(v.string())),
    candidates: v.optional(v.array(v.object({
      name: v.string(), evidence: v.string(),
      evidenceType: v.union(v.literal('audio'), v.literal('speech'), v.literal('screen_text'), v.literal('visual_landmark')),
      startSeconds: v.optional(v.number()), endSeconds: v.optional(v.number()),
    }))),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || !['queued', 'processing'].includes(record.status)) return null
    const now = Date.now()
    if (args.status === 'processing') {
      await ctx.db.patch(record._id, { status: 'processing', updatedAt: now })
      return null
    }
    if (args.status === 'needs_media' || args.status === 'failed') {
      await ctx.db.patch(record._id, {
        status: args.status,
        failureCode: args.failureCode?.slice(0, 80) ?? 'processing_failed',
        mediaStorageId: undefined,
        updatedAt: now,
      })
      if (record.mediaStorageId) await ctx.storage.delete(record.mediaStorageId)
      return null
    }
    const candidates = args.candidates ?? []
    if (candidates.length > 12 || candidates.some((item) => !item.name.trim() || item.name.length > 120 ||
      !item.evidence.trim() || item.evidence.length > 500 ||
      (item.startSeconds !== undefined && (!Number.isFinite(item.startSeconds) || item.startSeconds < 0 || item.startSeconds > 90)) ||
      (item.endSeconds !== undefined && (!Number.isFinite(item.endSeconds) || item.endSeconds < 0 || item.endSeconds > 90)))) {
      await ctx.db.patch(record._id, {
        status: 'failed', failureCode: 'invalid_worker_result', mediaStorageId: undefined, updatedAt: now,
      })
      if (record.mediaStorageId) await ctx.storage.delete(record.mediaStorageId)
      return null
    }
    await ctx.db.patch(record._id, {
      status: 'resolving_places',
      mediaSignals: args.mediaSignals,
      warningCodes: args.warningCodes,
      candidates: candidates.map((item) => ({ ...item, name: item.name.trim(), evidence: item.evidence.trim(), placeIDs: [] })),
      mediaStorageId: undefined,
      updatedAt: now,
    })
    if (record.mediaStorageId) await ctx.storage.delete(record.mediaStorageId)
    await ctx.scheduler.runAfter(0, internal.imports.resolvePlaces, { importId: record._id })
    return null
  },
})

export const candidatesForResolution = internalQuery({
  args: { importId: v.id('reelImports') },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.status !== 'resolving_places') return null
    return { candidates: record.candidates ?? [] }
  },
})

export const savePlaceIDs = internalMutation({
  args: { importId: v.id('reelImports'), placeIDs: v.array(v.array(v.string())) },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.status !== 'resolving_places') return null
    const candidates = record.candidates ?? []
    if (args.placeIDs.length !== candidates.length) throw new ConvexError('Place results did not match the import.')
    await ctx.db.patch(record._id, {
      candidates: candidates.map((item, index) => ({ ...item, placeIDs: [...new Set(args.placeIDs[index])].slice(0, 3) })),
      status: 'ready',
      updatedAt: Date.now(),
    })
    return null
  },
})

export const resolvePlaces = internalAction({
  args: { importId: v.id('reelImports') },
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(internal.imports.candidatesForResolution, { importId: args.importId })
    if (!result) return null
    const placeIDs = await Promise.all(result.candidates.map(async (item) => {
      try {
        const places: Array<{ providerPlaceID: string }> = await ctx.runAction(internal.places.search, { query: item.name, destination: '' })
        return places.slice(0, 3).map((place) => place.providerPlaceID)
      } catch { return [] }
    }))
    await ctx.runMutation(internal.imports.savePlaceIDs, { importId: args.importId, placeIDs })
    return null
  },
})

export const getForOwner = internalQuery({
  args: { ownerAuthUserId: v.string(), importId: v.id('reelImports') },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.ownerAuthUserId !== args.ownerAuthUserId) return null
    return {
      id: record._id,
      status: record.status,
      sourceURL: record.sourceURL ?? null,
      failureCode: record.failureCode ?? null,
      mediaSignals: record.mediaSignals ?? null,
      warningCodes: record.warningCodes ?? [],
      candidates: record.candidates ?? [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  },
})

export const listForOwner = internalQuery({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => {
    const records = await ctx.db.query('reelImports')
      .withIndex('by_ownerAuthUserId_and_createdAt', (q) => q.eq('ownerAuthUserId', args.ownerAuthUserId))
      .order('desc')
      .take(50)
    return records.map((record) => ({
      id: record._id,
      status: record.status,
      sourceURL: record.sourceURL ?? null,
      failureCode: record.failureCode ?? null,
      mediaSignals: record.mediaSignals ?? null,
      warningCodes: record.warningCodes ?? [],
      candidates: record.candidates ?? [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))
  },
})

export const deleteForOwner = internalMutation({
  args: { ownerAuthUserId: v.string(), importId: v.id('reelImports') },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId)
    if (!record || record.ownerAuthUserId !== args.ownerAuthUserId) return false
    if (record.mediaStorageId) await ctx.storage.delete(record.mediaStorageId)
    await ctx.db.delete(record._id)
    return true
  },
})

export const pruneStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const staleStates: Array<{ status: 'awaiting_upload' | 'queued' | 'processing' | 'resolving_places'; cutoff: number }> = [
      { status: 'awaiting_upload', cutoff: now - 24 * HOUR },
      { status: 'queued', cutoff: now - 2 * HOUR },
      { status: 'processing', cutoff: now - 2 * HOUR },
      { status: 'resolving_places', cutoff: now - 2 * HOUR },
    ]
    let cleaned = 0
    for (const stale of staleStates) {
      const rows = await ctx.db.query('reelImports')
        .withIndex('by_status_and_updatedAt', (q) => q.eq('status', stale.status).lt('updatedAt', stale.cutoff))
        .take(100)
      for (const record of rows) {
        if (record.mediaStorageId) await ctx.storage.delete(record.mediaStorageId)
        await ctx.db.patch(record._id, { status: 'failed', failureCode: 'processing_timeout', mediaStorageId: undefined, updatedAt: now })
        cleaned += 1
      }
    }
    return { cleaned }
  },
})
