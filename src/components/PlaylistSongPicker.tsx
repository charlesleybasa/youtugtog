import { useEffect, useRef, useState } from "react"

type Track = { id: string; title: string; artist: string }
type SearchItem = { id?: string | { videoId?: string }; title?: string; channelTitle?: string; snippet?: { title?: string; channelTitle?: string } }

export default function PlaylistSongPicker({ source, endpoint, queue, selected, currentId, onAdd }: {
  source: "youtube" | "queue"
  endpoint: string
  queue: Track[]
  selected: Track[]
  currentId: string | null
  onAdd: (songs: Track[]) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [searched, setSearched] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  useEffect(() => () => requestRef.current?.abort(), [])
  const ids = new Set(selected.map(song => song.id))
  const additions = queue.filter(song => !ids.has(song.id))
  const search = async () => {
    const term = query.trim()
    if (term.length < 2) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError("")
    setResults([])
    setSearched(true)
    try {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, { signal: controller.signal })
      const json = await response.json()
      if (!response.ok) throw new Error("YouTube search is unavailable right now. Please try again.")
      const decode = (text: string) => { const element = document.createElement("textarea"); element.innerHTML = text; return element.value }
      const songs: Track[] = (Array.isArray(json.items) ? json.items : []).flatMap((item: SearchItem) => {
        const id = typeof item.id === "string" ? item.id : item.id?.videoId
        return id ? [{ id, title: decode(item.title ?? item.snippet?.title ?? "Untitled"), artist: decode(item.channelTitle ?? item.snippet?.channelTitle ?? "YouTube") }] : []
      })
      if (!controller.signal.aborted) setResults([...new Map(songs.map(song => [song.id, song])).values()])
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search failed. Please try again.")
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  const songs = source === "queue" ? queue : results
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      {source === "youtube" ? (
        <form className="flex shrink-0 gap-2" onSubmit={event => { event.preventDefault(); void search() }}>
          <div className="neu-inset min-w-0 flex-1 rounded-xl px-3 py-3">
            <input type="search" aria-label="Search YouTube for playlist" placeholder="Search songs or artists…" value={query} onChange={event => setQuery(event.target.value)} className="w-full min-w-0 bg-transparent text-sm" style={{ color: "var(--text-strong)" }} />
          </div>
          <button type="submit" disabled={query.trim().length < 2} className="accent-btn rounded-xl px-4 text-sm font-bold">Search</button>
        </form>
      ) : (
        <div className="flex shrink-0 items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Choose songs from your current queue.</p>
          <button type="button" disabled={!additions.length} onClick={() => onAdd(additions)} className="neu-btn shrink-0 rounded-xl px-3 py-2 text-xs font-bold">Add all</button>
        </div>
      )}
      <div className="soft-scroll mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-2" aria-busy={source === "youtube" && loading}>
        {source === "youtube" && loading && <p role="status" className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>Searching YouTube…</p>}
        {source === "youtube" && error && <p role="alert" className="neu-inset rounded-xl p-4 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        {(source === "queue" || (!loading && !error)) && !songs.length && <p className="neu-inset rounded-2xl px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{source === "queue" ? "Your queue is empty. Find songs in the YouTube tab." : searched ? "No songs found. Try another artist or song." : "Find your next favorite and add it to this playlist."}</p>}
        {songs.map(song => (
          <div key={song.id} className="neu-inset flex items-center gap-3 rounded-2xl p-3">
            <img src={`https://i.ytimg.com/vi/${song.id}/mqdefault.jpg`} alt="" width={56} height={40} className="h-10 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold" style={{ color: "var(--text-strong)" }}>{song.title}</p>
              <p className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>{song.artist}{source === "queue" && song.id === currentId ? " · Now playing" : ""}</p>
            </div>
            <button type="button" disabled={ids.has(song.id)} onClick={() => onAdd([song])} aria-label={`${ids.has(song.id) ? "Added" : "Add"} ${song.title} to playlist`} className={`${ids.has(song.id) ? "neu-btn" : "accent-btn"} min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold`}>{ids.has(song.id) ? "✓ Added" : "+ Add"}</button>
          </div>
        ))}
      </div>
      <p role="status" aria-live="polite" className="shrink-0 pt-2 text-xs" style={{ color: "var(--text-muted)" }}>{selected.length} {selected.length === 1 ? "song" : "songs"} selected · Switch to Songs to arrange your playlist.</p>
    </div>
  )
}
