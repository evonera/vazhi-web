import { expect, test } from 'vitest'
import { cookieValue, makeContributorCookie, readContributorCookie } from '../src/lib/contributorIdentity'

const secret = 'test-only-edge-secret'
const id = 'f2e27d7f-4e0a-4d14-b282-05c185c9b3ee'

test('signed contributor cookies are opaque, stable, and reject tampering', async () => {
  const token = await makeContributorCookie(secret, id)
  expect(await readContributorCookie(token, secret)).toBe(id)
  expect(await readContributorCookie(token, 'another-secret')).toBeNull()
  expect(await readContributorCookie(`${token.slice(0, -1)}0`, secret)).toBeNull()
  expect(await readContributorCookie('arbitrary-client-id', secret)).toBeNull()
})

test('cookie parser returns the named cookie without trusting malformed values', () => {
  expect(cookieValue('theme=dark; vazhi_sender=v1.token.sig', 'vazhi_sender')).toBe('v1.token.sig')
  expect(cookieValue('vazhi_sender=%E0%A4%A', 'vazhi_sender')).toBeNull()
  expect(cookieValue('other=value', 'vazhi_sender')).toBeNull()
})
