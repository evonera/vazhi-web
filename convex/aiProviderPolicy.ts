export const AI_PROVIDER_TIMEOUT_MS = 15_000
export const AI_PROVIDER_MAX_COMPLETION_TOKENS = 900

/**
 * Quota is consumed when a provider request starts. A transient failure may
 * still incur provider cost, so it consumes quota; validation and missing
 * configuration fail before reservation and do not.
 */
export const AI_QUOTA_POLICY = Object.freeze({
  chargedWhen: 'provider_request_started' as const,
  transientProviderFailuresConsumeQuota: true,
  localValidationFailuresConsumeQuota: false,
  missingConfigurationConsumesQuota: false,
})

export type AIProviderConfiguration = {
  apiKey: string
  endpoint: string
  model: string
}

export function parseAIProviderConfiguration(environment: Record<string, string | undefined>): AIProviderConfiguration | null {
  const apiKey = environment.AI_CLOUD_API_KEY?.trim()
  const endpoint = environment.AI_CLOUD_API_URL?.trim() || 'https://api.openai.com/v1/chat/completions'
  const model = environment.AI_CLOUD_MODEL?.trim() || 'gpt-4.1-mini'
  if (!apiKey || apiKey.length > 4_096 || !model || model.length > 160 || endpoint.length > 2_048) return null
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    return { apiKey, endpoint: url.toString(), model }
  } catch {
    return null
  }
}
