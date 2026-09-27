export function authCapabilities() {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM),
    apple: Boolean(process.env.APPLE_SERVICE_ID && process.env.APPLE_CLIENT_SECRET),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  }
}

export async function deliverAuthEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.AUTH_EMAIL_FROM
  if (!key || !from) throw new Error('Email delivery is not configured.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  })
  // Never log provider bodies: they may contain addresses or verification links.
  if (!response.ok) throw new Error('Email delivery failed. Please try again later.')
}
