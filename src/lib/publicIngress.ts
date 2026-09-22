/**
 * Public forms must never become open ingress because an environment variable
 * happened to be absent. The sole exception is the explicitly labelled local
 * or Convex development deployment, where external Turnstile credentials are
 * intentionally not provisioned.
 */
export function developmentIngressSalt(environment: string | undefined, configuredSalt: string | undefined): string | undefined {
  if (configuredSalt) return configuredSalt
  return environment === 'development' ? 'development-only' : undefined
}

export function mayBypassTurnstile(environment: string | undefined, configuredSecret: string | undefined): boolean {
  return !configuredSecret && environment === 'development'
}
