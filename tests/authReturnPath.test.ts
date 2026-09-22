import { describe, expect, it } from 'vitest'
import { ownerSignInReturnPath } from '../src/lib/auth'

describe('owner sign-in return path', () => {
  it('returns identified Pro buyers to checkout preparation', () => {
    expect(ownerSignInReturnPath('/pro')).toBe('/pro')
  })

  it('never accepts arbitrary callback paths or origins', () => {
    for (const requested of [null, '/pro/extra', '//evil.example', 'https://evil.example', '/ask/demo-malaysia']) {
      expect(ownerSignInReturnPath(requested)).toBe('/requests')
    }
  })
})
