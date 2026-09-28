export const MAX_REEL_IMPORT_BODY_BYTES = 32 * 1024
export const MAX_REEL_VIDEO_BYTES = 20_000_000

export function reelVideoPreflight(headers: Headers):
  | { ok: true; contentType: string }
  | { ok: false; status: 413 | 415; message: string } {
  const contentType = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!['video/mp4', 'video/quicktime', 'video/x-m4v'].includes(contentType)) {
    return { ok: false, status: 415, message: 'Choose an MP4 or QuickTime video.' }
  }
  const declared = headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_REEL_VIDEO_BYTES)) {
    return { ok: false, status: 413, message: 'Choose a video under 20 MB.' }
  }
  return { ok: true, contentType }
}

/** HTTP actions do not validate arguments; reject chunked oversized bodies too. */
export async function readReelImportBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REEL_IMPORT_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_REEL_IMPORT_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export function parseImportBody(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function safeImportId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(value) ? value : null
}

export function safeIdempotencyKey(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null
}

export function safeSourceURL(value: unknown, required = false): string | null | undefined {
  if (value === undefined || value === null) return required ? null : undefined
  return typeof value === 'string' && value.length <= 2048 ? value : null
}
