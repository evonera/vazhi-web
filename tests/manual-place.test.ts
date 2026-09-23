import { describe, expect, it } from 'vitest'
import { manualPlace } from '../src/lib/manualPlace'

describe('manual place fallback', () => {
  it('keeps the contributor title and valid coordinates', () => {
    expect(manualPlace('  Old Town café ', '5.4164', '100.3327')).toEqual({
      provider: 'manual', name: 'Old Town café', latitude: 5.4164, longitude: 100.3327,
    })
  })

  it('rejects missing, invalid and out of range coordinates', () => {
    expect(manualPlace('Café', '', '100.3')).toBeNull()
    expect(manualPlace('Café', '5.4', '')).toBeNull()
    expect(manualPlace('Café', '5.4', 'nope')).toBeNull()
    expect(manualPlace('Café', '91', '100')).toBeNull()
    expect(manualPlace('Café', '5', '-181')).toBeNull()
    expect(manualPlace(' ', '5', '100')).toBeNull()
  })
})
