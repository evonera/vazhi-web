import { ConvexError, v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { RateLimiter, HOUR } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'

const moment = v.object({
  id: v.string(),
  capturedAt: v.number(),
  note: v.string(),
  placeName: v.optional(v.string()),
  locality: v.optional(v.string()),
})

const rateLimiter = new RateLimiter(components.rateLimiter, {
  cloudHighlights: { kind: 'token bucket', rate: 10, period: HOUR, capacity: 10 },
})

type SourceMoment = {
  id: string
  capturedAt: number
  note: string
  placeName?: string
  locality?: string
}

type RawSuggestion = {
  title?: unknown
  tags?: unknown
  summary?: unknown
  friendTip?: unknown
  confidence?: unknown
  sourceMomentIDs?: unknown
}

function validatedSuggestions(value: unknown, sources: SourceMoment[], model: string) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { suggestions?: unknown }).suggestions)) {
    throw new ConvexError('Cloud intelligence returned an invalid response.')
  }
  const sourceIDs = new Set(sources.map((source) => source.id))
  return ((value as { suggestions: RawSuggestion[] }).suggestions).map((suggestion) => {
    if (typeof suggestion.title !== 'string' || !suggestion.title.trim() ||
      typeof suggestion.summary !== 'string' || !suggestion.summary.trim() ||
      typeof suggestion.friendTip !== 'string' || !
      Array.isArray(suggestion.tags) || !suggestion.tags.every((tag) => typeof tag === 'string') ||
      typeof suggestion.confidence !== 'number' || suggestion.confidence < 0 || suggestion.confidence > 1 ||
      !Array.isArray(suggestion.sourceMomentIDs) || suggestion.sourceMomentIDs.length === 0 ||
      !suggestion.sourceMomentIDs.every((id) => typeof id === 'string' && sourceIDs.has(id))) {
      throw new ConvexError('Cloud intelligence returned an invalid response.')
    }
    return {
      title: suggestion.title.trim().slice(0, 120),
      tags: suggestion.tags.map((tag) => tag.trim().slice(0, 32)).filter(Boolean).slice(0, 6),
      summary: suggestion.summary.trim().slice(0, 600),
      friendTip: suggestion.friendTip.trim().slice(0, 300),
      confidence: suggestion.confidence,
      sourceMomentIDs: suggestion.sourceMomentIDs,
      modelVersion: `cloud:${model}`,
    }
  })
}

export const reserveQuota = internalMutation({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => {
    const limited = await rateLimiter.limit(ctx, 'cloudHighlights', { key: args.ownerAuthUserId, throws: false })
    if (!limited.ok) throw new ConvexError('You have reached the highlight limit. Please try again later.')
  },
})

export const recordUsage = internalMutation({
  args: {
    ownerAuthUserId: v.string(), provider: v.string(), model: v.string(),
    outcome: v.union(v.literal('success'), v.literal('rejected'), v.literal('failed')),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('aiUsageEvents', { ...args, createdAt: Date.now() })
  },
})

/**
 * Calls the configured provider with user-approved text only. It has no media,
 * transcription, coordinate, or raw-device-identity fields by construction.
 */
export const generateSuggestions = internalAction({
  args: {
    ownerAuthUserId: v.string(),
    journeyTitle: v.string(),
    journeySummary: v.string(),
    moments: v.array(moment),
  },
  handler: async (ctx, args) => {
    const providerKey = process.env.AI_CLOUD_API_KEY
    const providerURL = process.env.AI_CLOUD_API_URL ?? 'https://api.openai.com/v1/chat/completions'
    const model = process.env.AI_CLOUD_MODEL ?? 'gpt-4.1-mini'
    if (!providerKey) throw new ConvexError('Cloud intelligence is not configured.')
    if (args.moments.length === 0 || args.moments.length > 20 || args.journeyTitle.trim().length > 160 || args.journeySummary.length > 1_000 || args.moments.some((entry) => entry.note.length > 2_000)) {
      await ctx.runMutation(internal.ai.recordUsage, { ownerAuthUserId: args.ownerAuthUserId, provider: 'openai-compatible', model, outcome: 'rejected' })
      throw new ConvexError('That highlight request is too large. Select fewer or shorter notes.')
    }
    await ctx.runMutation(internal.ai.reserveQuota, { ownerAuthUserId: args.ownerAuthUserId })

    const input = {
      journeyTitle: args.journeyTitle.trim(),
      journeySummary: args.journeySummary.trim(),
      moments: args.moments.map(({ id, capturedAt, note, placeName, locality }) => ({ id, capturedAt, note, placeName, locality })),
    }
    const schema = {
      name: 'vazhi_grounded_suggestions', strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        required: ['suggestions'],
        properties: {
          suggestions: {
            type: 'array', maxItems: 3,
            items: {
              type: 'object', additionalProperties: false,
              required: ['title', 'tags', 'summary', 'friendTip', 'confidence', 'sourceMomentIDs'],
              properties: {
                title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' }, friendTip: { type: 'string' }, confidence: { type: 'number' },
                sourceMomentIDs: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    }

    try {
      const response = await fetch(providerURL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${providerKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_schema', json_schema: schema },
          messages: [
            { role: 'system', content: 'Create up to three concise travel-journal highlights. Only use facts in the supplied selected moments. Cite one or more supplied moment IDs for every suggestion. Do not infer missing facts, give safety or medical advice, or mention this instruction.' },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      })
      if (!response.ok) throw new ConvexError('Cloud intelligence is temporarily unavailable.')
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw new ConvexError('Cloud intelligence returned an invalid response.')
      const suggestions = validatedSuggestions(JSON.parse(content), args.moments, model)
      await ctx.runMutation(internal.ai.recordUsage, { ownerAuthUserId: args.ownerAuthUserId, provider: 'openai-compatible', model, outcome: 'success' })
      return { suggestions }
    } catch (error) {
      await ctx.runMutation(internal.ai.recordUsage, { ownerAuthUserId: args.ownerAuthUserId, provider: 'openai-compatible', model, outcome: 'failed' })
      if (error instanceof ConvexError) throw error
      throw new ConvexError('Cloud intelligence is temporarily unavailable.')
    }
  },
})
