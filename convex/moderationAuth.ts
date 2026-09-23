/** Constant-work comparison for the server-only moderation API bearer token. */
export function matchesModeratorToken(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false
  const left = new TextEncoder().encode(received)
  const right = new TextEncoder().encode(expected)
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}
