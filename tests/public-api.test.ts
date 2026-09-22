import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicAskAPI } from '../src/lib/api'

describe('public Ask API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the same-origin Worker for place search so edge signing cannot be bypassed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publicAskAPI.searchPlaces('Village Park', 'malaysia-in-november')).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/places/search', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: JSON.stringify({ query: 'Village Park', slug: 'malaysia-in-november' }),
    }))
  })
})
