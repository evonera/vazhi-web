import { describe, expect, it } from 'vitest'
import { validatedSuggestions } from '../src/lib/aiValidation'

const source = { id: 'moment-1', capturedAt: 1, note: 'Temple at sunrise' }
const suggestion = {
  title: 'Sunrise at the temple', tags: ['culture'], summary: 'A morning stop at the temple.',
  friendTip: 'Arrive early.', confidence: 0.9, sourceMomentIDs: ['moment-1'],
}

describe('cloud suggestion bounds', () => {
  it('deduplicates repeated valid citations before applying the selected-source bound', () => {
    const result = validatedSuggestions({ suggestions: [{ ...suggestion, sourceMomentIDs: ['moment-1', 'moment-1'] }] }, [source], 'test-model')
    expect(result[0].sourceMomentIDs).toEqual(['moment-1'])
  })

  it('rejects extra suggestions and unknown citations even when provider schema is ignored', () => {
    expect(() => validatedSuggestions({ suggestions: Array(4).fill(suggestion) }, [source], 'test-model')).toThrow()
    expect(() => validatedSuggestions({ suggestions: [{ ...suggestion, sourceMomentIDs: ['moment-2'] }] }, [source], 'test-model')).toThrow()
  })
})
