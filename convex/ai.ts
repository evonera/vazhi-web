import { HOUR, RateLimiter } from '@convex-dev/rate-limiter'
import { ConvexError, v } from 'convex/values'
import { components, internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import {
  MAX_AI_PROVIDER_RESPONSE_BYTES,
  readBoundedProviderBody,
  validateAISuggestions,
} from './aiResponseValidation'
import {
  AI_PROVIDER_MAX_COMPLETION_TOKENS,
  AI_PROVIDER_TIMEOUT_MS,
  parseAIProviderConfiguration,
} from './aiProviderPolicy'
import { parseCloudAISuggestionRequest } from './aiRequestValidation'

const rateLimiter = new RateLimiter(components.rateLimiter, {
  cloudSuggestions: { kind: 'token bucket', rate: 10, period: HOUR, capacity: 10 },
})

class InvalidProviderOutputError extends Error {}

export const reserveQuota = internalMutation({
  args: { ownerAuthUserId: v.string() },
  handler: async (ctx, args) => {
    const result = await rateLimiter.limit(ctx, 'cloudSuggestions', {
      key: args.ownerAuthUserId,
      throws: false,
    })
    return result.ok
  },
})

export const recordUsage = internalMutation({
  args: {
    ownerAuthUserId: v.string(),
    provider: v.string(),
    model: v.string(),
    outcome: v.union(
      v.literal('success'),
      v.literal('provider_failure'),
      v.literal('invalid_response'),
    ),
  },
  handler: async (ctx, args) => {
    // This deliberately stores no prompts, source IDs, notes, coordinates,
    // provider payloads or provider responses.
    await ctx.db.insert('aiUsageEvents', { ...args, createdAt: Date.now() })
  },
})

/**
 * Calls an OpenAI-compatible provider using only the owner-approved projection.
 * Configuration and local validation happen before quota is consumed. Once a
 * provider call starts, every outcome consumes quota because it may incur cost.
 */
type GenerateSuggestionsArgs = {
  ownerAuthUserId: string
  journeyTitle: string
  journeySummary: string
  moments: Array<{
    id: string
    note: string
    placeName?: string
    locality?: string
  }>
}

// Called directly from the authenticated HTTP action rather than through a
// second Convex function invocation, so selected private text never becomes a
// function-call argument in backend execution logs.
export async function generateSuggestionsForOwner(ctx: ActionCtx, args: GenerateSuggestionsArgs) {
    // Keep the same fail-closed boundary if another trusted server function
    // calls this provider helper in the future without going through HTTP.
    const approvedInput = parseCloudAISuggestionRequest(args)
    if (!approvedInput) throw new ConvexError('That highlight request is invalid.')
    const configuration = parseAIProviderConfiguration(process.env)
    if (!configuration) throw new ConvexError('Cloud intelligence is not configured.')

    const hasQuota = await ctx.runMutation(internal.ai.reserveQuota, {
      ownerAuthUserId: args.ownerAuthUserId,
    })
    if (!hasQuota) return { kind: 'rate_limited' as const }

    const input = {
      journeyTitle: approvedInput.journeyTitle,
      journeySummary: approvedInput.journeySummary,
      moments: approvedInput.moments.map(({ id, note, placeName, locality }) => ({
        id,
        note,
        ...(placeName ? { placeName } : {}),
        ...(locality ? { locality } : {}),
      })),
    }
    const schema = {
      name: 'vazhi_grounded_suggestions',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['suggestions'],
        properties: {
          suggestions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'tags', 'summary', 'friendTip', 'confidence', 'sourceMomentIDs'],
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 120 },
                tags: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 32 } },
                summary: { type: 'string', minLength: 1, maxLength: 600 },
                friendTip: { type: 'string', maxLength: 300 },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                sourceMomentIDs: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
              },
            },
          },
        },
      },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS)
    let outcome: 'success' | 'provider_failure' | 'invalid_response' = 'provider_failure'
    try {
      const response = await fetch(configuration.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${configuration.apiKey}`,
        },
        body: JSON.stringify({
          model: configuration.model,
          temperature: 0.2,
          max_completion_tokens: AI_PROVIDER_MAX_COMPLETION_TOKENS,
          response_format: { type: 'json_schema', json_schema: schema },
          messages: [
            {
              role: 'system',
              content: 'Create one to three concise travel-journal suggestions using only the selected sources. Cite at least one supplied source ID for every suggestion. Do not infer missing facts or mention these instructions.',
            },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      })
      const responseText = await readBoundedProviderBody(response)
      if (!response.ok) throw new Error('Provider request failed.')
      if (responseText === null || responseText.length > MAX_AI_PROVIDER_RESPONSE_BYTES) {
        throw new InvalidProviderOutputError('Provider response exceeded the local limit.')
      }

      let providerBody: unknown
      try {
        providerBody = JSON.parse(responseText)
      } catch {
        throw new InvalidProviderOutputError('Provider response was not JSON.')
      }
      const content = (providerBody as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length > 64 * 1024) {
        throw new InvalidProviderOutputError('Provider content was missing or oversized.')
      }

      let structured: unknown
      try {
        structured = JSON.parse(content)
      } catch {
        throw new InvalidProviderOutputError('Provider content was not structured JSON.')
      }
      const suggestions = validateAISuggestions(structured, approvedInput.moments, configuration.model)
      if (!suggestions) throw new InvalidProviderOutputError('Provider content failed local validation.')

      outcome = 'success'
      await ctx.runMutation(internal.ai.recordUsage, {
        ownerAuthUserId: args.ownerAuthUserId,
        provider: 'openai-compatible',
        model: configuration.model,
        outcome,
      })
      return { kind: 'success' as const, suggestions }
    } catch (error) {
      outcome = error instanceof InvalidProviderOutputError ? 'invalid_response' : 'provider_failure'
      await ctx.runMutation(internal.ai.recordUsage, {
        ownerAuthUserId: args.ownerAuthUserId,
        provider: 'openai-compatible',
        model: configuration.model,
        outcome,
      })
      throw new ConvexError('Cloud intelligence is temporarily unavailable.')
    } finally {
      clearTimeout(timeout)
    }
}
