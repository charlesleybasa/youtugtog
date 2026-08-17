import type { VercelRequest, VercelResponse } from '@vercel/node'
// package.json sets "type": "module", so these functions run as ESM on
// Vercel and Node requires an explicit file extension on relative imports.
// The extensionless form resolves fine at build time but throws
// ERR_MODULE_NOT_FOUND at invocation. TypeScript maps the .js specifier back
// to _cors.ts, so this is correct for both.
import { applyCors } from './_cors.js'

const API_KEY = process.env.YOUTUBE_API_KEY

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'Missing YOUTUBE_API_KEY in environment' })
  }

  const query = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing search query' })
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '8')
  url.searchParams.set('q', query)
  url.searchParams.set('key', API_KEY)

  const response = await fetch(url.toString())
  const data = await response.json()
  return res.status(response.status).json(data)
}
