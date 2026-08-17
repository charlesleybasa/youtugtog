import type { VercelRequest, VercelResponse } from '@vercel/node'

/* --------------------------------------------------------------------- *
 * CORS for the Capacitor WebView.
 *
 * On the web these functions are same-origin with the page, so the browser
 * never asks for CORS headers. The Android build is different: the WebView
 * serves the bundle from https://localhost and calls the API on
 * https://<your-deployment>, which is cross-origin. Without an
 * Access-Control-Allow-Origin header the WebView blocks the response and
 * search/lyrics silently fail.
 *
 * The origin is echoed from an allowlist rather than answered with "*",
 * because /api/search spends a keyed YouTube Data API quota and "*" would
 * let any web page burn it from a visitor's browser.
 *
 * Vercel does not turn leading-underscore files in /api into endpoints, so
 * this module is a shared helper, not a route.
 * --------------------------------------------------------------------- */

const ALLOWED_ORIGINS = [
  // Capacitor Android with `androidScheme: 'https'` (see capacitor.config.ts).
  'https://localhost',
  // Capacitor iOS default scheme, should the app ever ship there.
  'capacitor://localhost',
  // Capacitor Android if `androidScheme` is ever switched back to 'http'.
  'http://localhost',
]

function isAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true

  // Extra origins for previews/custom domains, comma-separated.
  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return extra.includes(origin)
}

/**
 * Apply CORS headers and answer preflights.
 *
 * @returns true when the request was fully handled and the caller should
 *          return immediately (preflight only).
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''

  // Set unconditionally: /api/lyrics is cached with `s-maxage`, and without
  // Vary the CDN could hand a response cached for one origin to another.
  res.setHeader('Vary', 'Origin')

  if (origin && isAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '86400')
    res.status(204).end()
    return true
  }

  return false
}
