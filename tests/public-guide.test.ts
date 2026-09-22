import { describe, expect, it } from 'vitest'
import { redactPublicCoordinates } from '../src/lib/publicGuide'

describe('public guide location redaction', () => {
  const exactStop = { title: 'Private pin', latitude: 3.136, longitude: 101.619, isApproximateLocation: false }

  it('omits exact coordinates when the whole guide is approximate', () => {
    expect(redactPublicCoordinates(exactStop, true)).toEqual({
      title: 'Private pin', latitude: undefined, longitude: undefined, isApproximateLocation: true,
    })
  })

  it('omits coordinates when only the stop is approximate', () => {
    expect(redactPublicCoordinates({ ...exactStop, isApproximateLocation: true }, false).latitude).toBeUndefined()
  })

  it('retains exact coordinates only after both privacy choices permit them', () => {
    expect(redactPublicCoordinates(exactStop, false)).toEqual(exactStop)
  })
})
