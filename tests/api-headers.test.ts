import { describe, expect, it } from 'vitest'
import { requestHeaders } from '../src/lib/api'

describe('public API request headers', () => {
  it('keeps bodyless public reads simple so they do not trigger CORS preflight', () => {
    expect(requestHeaders().has('content-type')).toBe(false)
    expect(requestHeaders({ method: 'GET' }).has('content-type')).toBe(false)
  })

  it('adds JSON content type for writes without overriding an explicit type', () => {
    expect(requestHeaders({ method: 'POST', body: '{}' }).get('content-type')).toBe('application/json')
    expect(requestHeaders({ body: '{}', headers: { 'content-type': 'application/merge-patch+json' } }).get('content-type'))
      .toBe('application/merge-patch+json')
  })
})
