import type { VercelRequest, VercelResponse } from '@vercel/node'
// See the note in search.ts: "type": "module" makes these ESM, so the
// relative import needs an explicit extension or the function crashes at
// invocation with ERR_MODULE_NOT_FOUND.
import { applyCors } from './_cors.js'

/* --------------------------------------------------------------------- *
 * Lyrics proxy — LRCLIB (https://lrclib.net)
 *
 * LRCLIB does not send CORS headers, so the browser cannot call it
 * directly; this server hop is required, not a convenience. It needs no
 * API key, unlike the YouTube search proxy.
 *
 * LRCLIB asks clients to identify themselves via User-Agent.
 * --------------------------------------------------------------------- */

const LRCLIB = 'https://lrclib.net/api'
const UA = 'Youtugtog (https://youtugtog.vercel.app)'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const track = first(req.query.track)?.trim()
  const artist = first(req.query.artist)?.trim()
  const album = first(req.query.album)?.trim()
  const duration = first(req.query.duration)?.trim()

  if (!track) {
    return res.status(400).json({ error: 'Missing track name' })
  }

  try {
    // 1) Exact-ish match. LRCLIB uses duration to disambiguate versions.
    const get = new URL(`${LRCLIB}/get`)
    get.searchParams.set('track_name', track)
    get.searchParams.set('artist_name', artist || '')
    if (album) get.searchParams.set('album_name', album)
    if (duration && Number.isFinite(Number(duration))) {
      get.searchParams.set('duration', String(Math.round(Number(duration))))
    }

    let response = await fetch(get.toString(), { headers: { 'User-Agent': UA } })

    // 2) No exact hit — fall back to fuzzy search and take the best result.
    if (response.status === 404) {
      const search = new URL(`${LRCLIB}/search`)
      search.searchParams.set('track_name', track)
      if (artist) search.searchParams.set('artist_name', artist)
      if (album) search.searchParams.set('album_name', album)

      const searchRes = await fetch(search.toString(), { headers: { 'User-Agent': UA } })
      if (!searchRes.ok) {
        return res.status(404).json({ error: 'No lyrics found' })
      }

      const list = (await searchRes.json()) as unknown
      const results = Array.isArray(list) ? list : []
      if (!results.length) {
        return res.status(404).json({ error: 'No lyrics found' })
      }

      // Prefer a synced result, and the closest duration when we know it.
      const target = duration ? Number(duration) : null
      const score = (item: { syncedLyrics?: string | null; duration?: number }) => {
        const synced = item.syncedLyrics ? 0 : 1000
        const drift =
          target && item.duration ? Math.abs(item.duration - target) : 0
        return synced + drift
      }
      const best = results.slice().sort((a, b) => score(a) - score(b))[0]

      res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400')
      return res.status(200).json(best)
    }

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json(data)
    }

    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400')
    return res.status(200).json(data)
  } catch {
    return res.status(502).json({ error: 'Lyrics service unavailable' })
  }
}
