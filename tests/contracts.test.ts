import { describe, expect, it } from 'vitest'
import { isSafeReferenceURL } from '../src/lib/contracts'

describe('reference URL validation', () => {
  it('allows HTTPS references only', () => {
    expect(isSafeReferenceURL('https://maps.google.com/?q=Village+Park')).toBe(true)
    expect(isSafeReferenceURL('http://example.com')).toBe(false)
    expect(isSafeReferenceURL('javascript:alert(1)')).toBe(false)
  })
})
