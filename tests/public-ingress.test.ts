import { describe, expect, it } from 'vitest'
import { developmentIngressSalt, mayBypassTurnstile } from '../src/lib/publicIngress'

describe('public ingress configuration', () => {
  it('uses a configured rate-limit salt in every environment', () => {
    expect(developmentIngressSalt('production', 'secret-salt')).toBe('secret-salt')
    expect(developmentIngressSalt('development', 'secret-salt')).toBe('secret-salt')
  })

  it('provides the predictable salt only for an explicitly named development deployment', () => {
    expect(developmentIngressSalt('development', undefined)).toBe('development-only')
    expect(developmentIngressSalt('production', undefined)).toBeUndefined()
    expect(developmentIngressSalt(undefined, undefined)).toBeUndefined()
    expect(developmentIngressSalt('preview', undefined)).toBeUndefined()
  })

  it('never bypasses Turnstile outside explicitly named development', () => {
    expect(mayBypassTurnstile('development', undefined)).toBe(true)
    expect(mayBypassTurnstile('production', undefined)).toBe(false)
    expect(mayBypassTurnstile(undefined, undefined)).toBe(false)
    expect(mayBypassTurnstile('preview', undefined)).toBe(false)
    expect(mayBypassTurnstile('development', 'turnstile-secret')).toBe(false)
  })
})
