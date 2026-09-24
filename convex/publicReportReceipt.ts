/**
 * Public report submissions intentionally return the same receipt for valid,
 * unknown, malformed, or rate-limited reports. The callback owns persistence.
 */
export async function acceptPublicReport(
  request: Request,
  submit: (input: Record<string, unknown>) => Promise<void>,
) {
  try {
    const value: unknown = await request.json()
    const input = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    await submit(input)
  } catch {
    // Do not turn parse, persistence, or existence failures into a public oracle.
  }
  return { accepted: true as const }
}

