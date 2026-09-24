import { describe, expect, it } from 'vitest'
import {
  hasOversizedAIRequest,
  MAX_AI_REQUEST_BYTES,
  parseCloudAISuggestionRequest,
  readBoundedAIRequestBody,
} from '../convex/aiRequestValidation'
import {
  MAX_AI_PROVIDER_RESPONSE_BYTES,
  readBoundedProviderBody,
  validateAISuggestions,
} from '../convex/aiResponseValidation'
import {
  AI_PROVIDER_MAX_COMPLETION_TOKENS,
  AI_PROVIDER_TIMEOUT_MS,
  AI_QUOTA_POLICY,
  parseAIProviderConfiguration,
} from '../convex/aiProviderPolicy'

const sources = [
  { id: 'moment-1', note: 'Loved the old market.', placeName: 'Central Market', locality: 'Kuala Lumpur' },
  { id: 'moment-2', note: 'Quiet after sunset.' },
]

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Market morning',
    tags: ['Food', 'food', 'Culture'],
    summary: 'Start at the market.',
    friendTip: 'Arrive early.',
    confidence: 0.8,
    sourceMomentIDs: ['moment-1', 'moment-1'],
    ...overrides,
  }
}

describe('cloud AI request projection', () => {
  it('keeps only explicitly supported selected text fields', () => {
    const parsed = parseCloudAISuggestionRequest({
      journeyTitle: ' Malaysia ',
      journeySummary: ' Food and culture ',
      moments: [{
        id: ' moment-1 ',
        note: ' Market ',
        placeName: ' Central Market ',
        locality: ' Kuala Lumpur ',
        transcript: 'must not leave the boundary',
        latitude: 3.139,
        longitude: 101.686,
        mediaURL: 'file:///private/photo.jpg',
        unselectedNote: 'private',
      }],
      rawMoments: [{ note: 'private' }],
    })

    expect(parsed).toEqual({
      journeyTitle: 'Malaysia',
      journeySummary: 'Food and culture',
      moments: [{
        id: 'moment-1', note: 'Market', placeName: 'Central Market', locality: 'Kuala Lumpur',
      }],
    })
    expect(JSON.stringify(parsed)).not.toMatch(/transcript|latitude|longitude|mediaURL|unselected|rawMoments/)
  })

  it('rejects duplicate source IDs and requests outside local bounds', async () => {
    expect(parseCloudAISuggestionRequest({ moments: [{ id: 'same', note: '' }, { id: 'same', note: '' }] })).toBeNull()
    expect(parseCloudAISuggestionRequest({ moments: [] })).toBeNull()
    expect(parseCloudAISuggestionRequest({ moments: [{ id: '1', note: 'x'.repeat(2_001) }] })).toBeNull()
    expect(hasOversizedAIRequest(String(MAX_AI_REQUEST_BYTES + 1))).toBe(true)
    expect(hasOversizedAIRequest(null, MAX_AI_REQUEST_BYTES + 1)).toBe(true)
    expect(hasOversizedAIRequest('not-a-number', 100)).toBe(false)
    const oversizedChunkedRequest = new Request('https://vazhi.app/api/ai/suggestions', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(MAX_AI_REQUEST_BYTES)))
          controller.enqueue(new TextEncoder().encode('x'))
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    expect(oversizedChunkedRequest.headers.get('content-length')).toBeNull()
    expect(await readBoundedAIRequestBody(oversizedChunkedRequest)).toBeNull()
    expect(await readBoundedAIRequestBody(new Request('https://vazhi.app/api/ai/suggestions', {
      method: 'POST', body: '{"moments":[]}', duplex: 'half',
    } as RequestInit))).toBe('{"moments":[]}')
  })
})

describe('cloud AI response boundary', () => {
  it('deduplicates bounded tags and known source IDs', () => {
    expect(validateAISuggestions({ suggestions: [suggestion()] }, sources, 'test-model')).toEqual([{
      title: 'Market morning',
      tags: ['Food', 'Culture'],
      summary: 'Start at the market.',
      friendTip: 'Arrive early.',
      confidence: 0.8,
      sourceMomentIDs: ['moment-1'],
      modelVersion: 'cloud:test-model',
    }])
  })

  it('rejects more than three suggestions and unknown source IDs', () => {
    expect(validateAISuggestions({ suggestions: [suggestion(), suggestion(), suggestion(), suggestion()] }, sources, 'm')).toBeNull()
    expect(validateAISuggestions({ suggestions: [suggestion({ sourceMomentIDs: ['moment-3'] })] }, sources, 'm')).toBeNull()
    expect(validateAISuggestions({ suggestions: [suggestion({ summary: 'x'.repeat(601) })] }, sources, 'm')).toBeNull()
  })

  it('stops reading oversized provider bodies', async () => {
    const oversized = new Response('x'.repeat(MAX_AI_PROVIDER_RESPONSE_BYTES + 1))
    expect(await readBoundedProviderBody(oversized)).toBeNull()
    expect(await readBoundedProviderBody(new Response('{"ok":true}'))).toBe('{"ok":true}')
  })
})

describe('cloud AI provider and quota policy', () => {
  it('requires an HTTPS secret-bearing provider configuration', () => {
    expect(parseAIProviderConfiguration({ AI_CLOUD_API_KEY: 'secret' })).toMatchObject({
      endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini',
    })
    expect(parseAIProviderConfiguration({ AI_CLOUD_API_KEY: 'secret', AI_CLOUD_API_URL: 'http://localhost:8000' })).toBeNull()
    expect(parseAIProviderConfiguration({ AI_CLOUD_API_KEY: '', AI_CLOUD_API_URL: 'https://example.com' })).toBeNull()
    expect(AI_PROVIDER_MAX_COMPLETION_TOKENS).toBeLessThanOrEqual(900)
    expect(AI_PROVIDER_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })

  it('charges transient failures only after a provider request starts', () => {
    expect(AI_QUOTA_POLICY).toEqual({
      chargedWhen: 'provider_request_started',
      transientProviderFailuresConsumeQuota: true,
      localValidationFailuresConsumeQuota: false,
      missingConfigurationConsumesQuota: false,
    })
  })
})
