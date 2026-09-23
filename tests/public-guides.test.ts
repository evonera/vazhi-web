import { describe, expect, it } from 'vitest'
import { sanitizePublicGuideStops } from '../convex/publicGuideSanitization'

describe('public guide snapshot sanitization', () => {
  it('normalizes order and strips approximate coordinates from published stops', () => {
    const stops = sanitizePublicGuideStops([
      {
        orderIndex: 5,
        title: '  Sunset point  ',
        notes: '  Arrive before golden hour.  ',
        placeName: '  Viewpoint  ',
        locality: '  Fort Kochi  ',
        latitude: 9.967432,
        longitude: 76.244918,
        isApproximateLocation: true,
      },
      {
        orderIndex: 9,
        title: 'Breakfast',
        notes: 'Order the appam.',
        latitude: 9.96,
        longitude: 76.24,
        isApproximateLocation: false,
      },
    ])

    expect(stops[0]).toMatchObject({ orderIndex: 0, title: 'Sunset point', notes: 'Arrive before golden hour.', placeName: 'Viewpoint', locality: 'Fort Kochi', isApproximateLocation: true })
    expect(stops[0].latitude).toBeUndefined()
    expect(stops[0].longitude).toBeUndefined()
    expect(stops[1]).toMatchObject({ orderIndex: 1, latitude: 9.96, longitude: 76.24 })
    expect(JSON.stringify(stops[0])).not.toContain('9.967432')
  })

  it('rejects duplicate, negative, or out-of-range coordinates', () => {
    const base = { title: 'Stop', notes: '', isApproximateLocation: false }
    expect(() => sanitizePublicGuideStops([{ ...base, orderIndex: 0 }, { ...base, orderIndex: 0 }])).toThrow('unique order')
    expect(() => sanitizePublicGuideStops([{ ...base, orderIndex: -1 }])).toThrow('unique order')
    expect(() => sanitizePublicGuideStops([{ ...base, orderIndex: 0, latitude: 91 }])).toThrow('invalid latitude')
    expect(() => sanitizePublicGuideStops([{ ...base, orderIndex: 0, longitude: 181 }])).toThrow('invalid longitude')
  })
})
