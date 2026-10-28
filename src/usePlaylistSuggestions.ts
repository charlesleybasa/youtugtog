import { useEffect, useMemo, useState } from "react"

type Song = { id: string; title: string; artist: string }
type Playlist = { tracks: Song[] }
const cache = new Map<string, { time: number; songs: Song[] }>()

export default function usePlaylistSuggestions(open: boolean, playlists: Playlist[], endpoint: string) {
  const seeds = useMemo(() => {
    const songs = new Map<string, Song>()
    for (const playlist of playlists) for (const song of playlist.tracks) songs.set(song.id, song)
    const artists = new Map<string, { name: string; count: number }>()
    for (const song of songs.values()) {
      const name = song.artist.replace(/\s*[-–]\s*Topic$/i, "").replace(/VEVO$/i, "").trim()
      if (!name || /fetching|tap to play|unknown|^youtube$/i.test(name)) continue
      const key = name.toLowerCase()
      const existing = artists.get(key)
      artists.set(key, { name, count: (existing?.count ?? 0) + 1 })
    }
    return { ids: new Set(songs.keys()), artists: [...artists.values()].sort((a, b) => b.count - a.count).slice(0, 2).map(a => a.name) }
  }, [playlists])
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setSongs([])
    setError("")
    if (!seeds.artists.length) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      const batches = await Promise.allSettled(seeds.artists.map(async artist => {
        const key = `${endpoint}:${artist.toLowerCase()}`
        const cached = cache.get(key)
        if (cached && Date.now() - cached.time < 30 * 60 * 1000) return cached.songs
        const response = await fetch(`${endpoint}?q=${encodeURIComponent(`${artist} music`)}`, { signal: controller.signal })
        if (!response.ok) throw new Error("Suggestions unavailable")
        const json = await response.json()
        const decoded = (value: string) => {
          const element = document.createElement("textarea")
          element.innerHTML = value
          return element.value
        }
        const results: Song[] = (Array.isArray(json.items) ? json.items : []).flatMap((item: any) => {
          const id = typeof item.id === "string" ? item.id : item.id?.videoId
          if (!id) return []
          return [{ id, title: decoded(item.title ?? item.snippet?.title ?? "Untitled"), artist: decoded(item.channelTitle ?? item.snippet?.channelTitle ?? "YouTube") }]
        })
        if (!controller.signal.aborted) {
          if (cache.size >= 20) cache.delete(cache.keys().next().value!)
          cache.set(key, { time: Date.now(), songs: results })
        }
        return results
      }))
      if (controller.signal.aborted) return
      const unique = new Map<string, Song>()
      for (const batch of batches) if (batch.status === "fulfilled") {
        for (const song of batch.value) if (!seeds.ids.has(song.id)) unique.set(song.id, song)
      }
      setSongs([...unique.values()].slice(0, 8))
      if (batches.every(batch => batch.status === "rejected")) setError("Suggestions are unavailable right now. You can still search for a song.")
      setLoading(false)
    })()
    return () => controller.abort()
  }, [open, seeds, endpoint])

  return { songs, loading, error, hasPlaylists: seeds.artists.length > 0 }
}
