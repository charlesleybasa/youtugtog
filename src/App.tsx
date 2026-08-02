import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import logoUrl from './imports/ChatGPT_Image_Jul_30__2026__01_48_16_PM.png'

/* --------------------------------------------------------------------- *
 * Youtugtog — "Tutog Pinoy anytime".
 * A minimalist, YouTube-powered player. Playback runs through the OFFICIAL
 * YouTube IFrame Player API (video stays embedded, views + ads count), so
 * nothing here breaks YouTube's terms. We never extract audio streams.
 * --------------------------------------------------------------------- */

type Track = { id: string; title: string; artist: string }
type Repeat = 'off' | 'all' | 'one'

const STARTER: Track[] = [
  { id: 'JGwWNGJdvx8', title: 'Shape of You', artist: 'Ed Sheeran' },
  { id: 'OPf0YbXqDm0', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars' },
  { id: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee' },
  { id: 'RgKAFK5djSk', title: 'See You Again', artist: 'Wiz Khalifa ft. Charlie Puth' },
  { id: 'hT_nvWreIhg', title: 'Counting Stars', artist: 'OneRepublic' },
  { id: '60ItHLz5WEA', title: 'Faded', artist: 'Alan Walker' },
  { id: 'CevxZvSJLk8', title: 'Roar', artist: 'Katy Perry' },
  { id: '2Vv-BfVoq4g', title: 'Perfect', artist: 'Ed Sheeran' },
  { id: 'YQHsXMglC9A', title: 'Hello', artist: 'Adele' },
]

const SEARCH_PROXY = '/api/search'

function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  const m = s.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

function loadYouTubeApi(): Promise<any> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT)
    }
    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script')
      tag.id = 'yt-iframe-api'
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
  })
}

function IconButton({
  children,
  onClick,
  size = 48,
  label,
}: {
  children: ReactNode
  onClick?: () => void
  size?: number
  label: string
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="neu-btn grid place-items-center rounded-full"
      style={{ width: size, height: size, color: 'var(--text)' }}
    >
      {children}
    </button>
  )
}

/* ---- Playlist row: drag-to-reorder + swipe-to-delete --------------- */
function TrackRow({
  track,
  isCurrent,
  playing,
  isDragging,
  onPlay,
  onDelete,
  onDragStart,
}: {
  track: Track
  isCurrent: boolean
  playing: boolean
  isDragging: boolean
  onPlay: () => void
  onDelete: () => void
  onDragStart: () => void
}) {
  const [dx, setDx] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  const onDown = (e: ReactPointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY }
    moved.current = false
  }
  const onMovePtr = (e: ReactPointerEvent) => {
    if (!start.current) return
    const diffX = e.clientX - start.current.x
    const diffY = e.clientY - start.current.y
    if (!swiping && Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
      setSwiping(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    }
    if (swiping || Math.abs(diffX) > 8) {
      moved.current = true
      setDx(Math.min(0, diffX)) // only allow swiping left
    }
  }
  const onUp = () => {
    if (dx < -96) onDelete()
    setDx(0)
    setSwiping(false)
    start.current = null
  }
  const onClick = () => {
    if (!moved.current) onPlay()
  }

  const isPlayingThis = isCurrent && playing

  return (
    <li
      data-track-id={track.id}
      className="relative overflow-hidden rounded-2xl"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {/* red delete layer revealed on swipe */}
      <div
        className="absolute inset-0 flex items-center justify-end rounded-2xl pr-6"
        style={{ background: 'linear-gradient(90deg, #ff8a2b, #f5317f)' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div
        className={`swipe-row ${swiping ? 'dragging' : ''} ${isCurrent ? 'neu-inset' : 'neu-sm'} ${isDragging ? 'ring-2' : ''} flex items-center gap-2 rounded-2xl py-3 pl-2 pr-3`}
        style={{ transform: `translateX(${dx}px)`, ...(isDragging ? { boxShadow: '0 10px 24px var(--art-glow)' } : {}) }}
        onPointerDown={onDown}
        onPointerMove={onMovePtr}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* drag handle (left) */}
        <button
          aria-label="Drag to reorder"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onDragStart()
          }}
          className="grid h-10 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg active:cursor-grabbing"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor">
            {[4, 10, 16].map((cy) =>
              [4, 10].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />),
            )}
          </svg>
        </button>

        <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <img
            src={`https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`}
            alt=""
            draggable={false}
            className="h-12 w-16 shrink-0 rounded-xl object-cover"
            style={{ background: 'var(--sh-dark)' }}
          />
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-medium"
              style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-strong)' }}
            >
              {track.title}
            </p>
            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {track.artist}
            </p>
          </div>
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isCurrent ? 'accent-btn' : 'neu-sm'}`}
            style={{ color: isCurrent ? '#fff' : 'var(--text-muted)' }}
          >
            {isPlayingThis ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </span>
        </button>

        <button
          aria-label="Remove"
          onClick={onDelete}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </li>
  )
}

export default function App() {
  const [dark, setDark] = useState(false)
  const [tracks, setTracks] = useState<Track[]>(STARTER)
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [addValue, setAddValue] = useState('')
  const [addError, setAddError] = useState(false)
  const [currentId, setCurrentId] = useState(STARTER[0].id)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [repeat, setRepeat] = useState<Repeat>('off')
  const [dragId, setDragId] = useState<string | null>(null)

  const playerRef = useRef<any>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const tick = useRef<number | null>(null)

  const currentIdx = Math.max(0, tracks.findIndex((t) => t.id === currentId))
  const track = tracks[currentIdx]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
  }, [tracks, query])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  useEffect(() => {
    if (!searchOpen) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false)
    }
    document.body.style.overflow = 'hidden'
    searchInputRef.current?.focus()
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [searchOpen])

  /* live refs for the ENDED handler */
  const stateRef = useRef({ tracks, currentId, repeat })
  useEffect(() => {
    stateRef.current = { tracks, currentId, repeat }
  }, [tracks, currentId, repeat])

  const advance = useCallback((delta: number) => {
    const { tracks: ts, currentId: cid } = stateRef.current
    if (!ts.length) return
    const idx = ts.findIndex((t) => t.id === cid)
    const next = ((idx + delta) % ts.length + ts.length) % ts.length
    setCurrentId(ts[next].id)
    setPlaying(true)
  }, [])

  const handleEnded = useCallback(() => {
    const { tracks: ts, currentId: cid, repeat: rp } = stateRef.current
    const idx = ts.findIndex((t) => t.id === cid)
    if (rp === 'one') {
      playerRef.current?.seekTo?.(0, true)
      playerRef.current?.playVideo?.()
      return
    }
    if (idx === ts.length - 1 && rp === 'off') {
      setPlaying(false)
      return
    }
    advance(1)
  }, [advance])

  /* build the player once */
  useEffect(() => {
    let killed = false
    loadYouTubeApi().then((YT) => {
      if (killed || !mountRef.current) return
      playerRef.current = new YT.Player(mountRef.current, {
        videoId: STARTER[0].id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e: any) => {
            e.target.setVolume(volume)
            setReady(true)
          },
          onStateChange: (e: any) => {
            const S = window.YT.PlayerState
            if (e.data === S.PLAYING) setPlaying(true)
            else if (e.data === S.PAUSED) setPlaying(false)
            else if (e.data === S.ENDED) handleEnded()
          },
        },
      })
    })
    return () => {
      killed = true
      if (tick.current) window.clearInterval(tick.current)
      playerRef.current?.destroy?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* poll time while playing */
  useEffect(() => {
    if (tick.current) window.clearInterval(tick.current)
    if (playing) {
      tick.current = window.setInterval(() => {
        const p = playerRef.current
        if (!p?.getCurrentTime) return
        setTime(p.getCurrentTime() || 0)
        setDuration(p.getDuration() || 0)
      }, 250)
    }
    return () => {
      if (tick.current) window.clearInterval(tick.current)
    }
  }, [playing])

  /* load new video when current changes */
  const didInit = useRef(false)
  useEffect(() => {
    const p = playerRef.current
    if (!ready || !p || !track) return
    if (!didInit.current) {
      // first time the player is ready: cue the track paused, never autoplay
      didInit.current = true
      p.cueVideoById(track.id)
      return
    }
    // track changed by user action -> load and play
    p.loadVideoById(track.id)
    setTime(0)
    setDuration(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, ready])

  useEffect(() => {
    playerRef.current?.setVolume?.(volume)
  }, [volume])

  const toggle = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (playing) p.pauseVideo()
    else p.playVideo()
  }, [playing])

  const playTrack = (id: string) => {
    if (id === currentId) toggle()
    else {
      setCurrentId(id)
      setPlaying(true)
      playerRef.current?.playVideo?.()
    }
  }

  const deleteTrack = (id: string) => {
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (id === currentId && next.length) {
        const idx = prev.findIndex((t) => t.id === id)
        setCurrentId(next[Math.min(idx, next.length - 1)].id)
      }
      return next
    })
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = playerRef.current
    if (!p || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    p.seekTo(ratio * duration, true)
    setTime(ratio * duration)
  }

  const addTrack = () => {
    const id = parseVideoId(addValue)
    if (!id) {
      setAddError(true)
      return
    }
    setAddError(false)
    setAddValue('')
    // Already in the playlist: just clear the input. Never interrupt the
    // track that's currently playing.
    if (tracks.some((t) => t.id === id)) {
      return
    }
    // Append to the playlist only. The current track keeps playing; the new
    // one waits until the user taps it.
    setTracks((prev) => [...prev, { id, title: 'Added from YouTube', artist: 'Tap to play' }])
  }

  const addSearchResult = (result: Track) => {
    if (tracks.some((t) => t.id === result.id)) return
    setTracks((prev) => [...prev, result])
  }

  const searchYouTube = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearchError('')
    setSearchLoading(true)
    setSearchResults([])
    try {
      const response = await fetch(`${SEARCH_PROXY}?q=${encodeURIComponent(q)}`)
      const json = await response.json()
      if (!response.ok) {
        const errorValue = json.error
        const message =
          typeof errorValue === 'string'
            ? errorValue
            : errorValue?.message || json?.error?.errors?.[0]?.message || `Unable to search YouTube (${response.status})`
        const blocked = /blocked|referer|permission|restricted|forbidden/i.test(message)
        throw new Error(
          blocked
            ? 'YouTube blocked the search request. Fix API key restrictions or set a valid YOUTUBE_API_KEY for the local proxy.'
            : message,
        )
      }
      const items = Array.isArray(json.items) ? json.items : []
      const parsed: Array<{ id?: string; title: string; artist: string }> = items.map(
        (item: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }) => ({
          id: item.id?.videoId,
          title: item.snippet?.title ?? 'Untitled',
          artist: item.snippet?.channelTitle ?? 'Unknown channel',
        }),
      )
      const results = parsed.filter(
        (item: { id?: string; title: string; artist: string }): item is Track => Boolean(item.id),
      )
      setSearchResults(results)
      if (results.length === 0) {
        setSearchError('No videos found for that search.')
      }
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : 'Search failed. Make sure the proxy is running and the request is allowed.',
      )
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery])

  // drag-to-reorder: move the dragged track to occupy the target's slot
  const reorderTo = useCallback((targetId: string) => {
    setTracks((prev) => {
      const from = prev.findIndex((t) => t.id === dragIdRef.current)
      const to = prev.findIndex((t) => t.id === targetId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const dragIdRef = useRef<string | null>(null)
  useEffect(() => {
    dragIdRef.current = dragId
  }, [dragId])

  const startDrag = useCallback(
    (id: string) => {
      setDragId(id)
      const onMove = (e: PointerEvent) => {
        const el = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest('[data-track-id]') as HTMLElement | null
        const overId = el?.dataset.trackId
        if (overId && overId !== dragIdRef.current) reorderTo(overId)
      }
      const onUp = () => {
        setDragId(null)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [reorderTo],
  )

  const cycleRepeat = () =>
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))

  const progress = duration ? (time / duration) * 100 : 0

  return (
    <div className="min-h-screen w-full px-4 py-8 sm:px-8 lg:px-12">
      {/* Header ----------------------------------------------------- */}
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="neu-sm grid h-20 w-20 place-items-center rounded-3xl p-2 sm:h-24 sm:w-24">
            <img src={logoUrl} alt="Youtugtog logo" className="h-full w-full object-contain" />
          </div>
          <div>
            <p
              className="font-display text-2xl font-bold leading-none tracking-tight sm:text-3xl"
              style={{
                background: 'linear-gradient(120deg, #ff8a2b, #f5317f)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Youtugtog
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              Tutog Pinoy anytime
            </p>
          </div>
        </div>

        <IconButton label="Toggle dark mode" onClick={() => setDark((d) => !d)} size={46}>
          {dark ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="4" stroke="var(--accent)" strokeWidth="2" />
              {[...Array(8)].map((_, i) => (
                <line key={i} x1="12" y1="2" x2="12" y2="4.5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 45} 12 12)`} />
              ))}
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          )}
        </IconButton>
      </header>

      <main className="mx-auto mt-8 grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,400px)_1fr]">
        {/* Now playing ------------------------------------------- */}
        <section className="neu rounded-[2rem] p-6">
          <p className="text-center font-display text-[0.7rem] font-semibold uppercase tracking-[0.35em]" style={{ color: 'var(--text-muted)' }}>
            Now Playing
          </p>

          <div className="neu-inset mt-6 overflow-hidden rounded-3xl p-2">
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
              <div ref={mountRef} className="absolute inset-0 h-full w-full" />
              {!ready && (
                <div className="absolute inset-0 grid place-items-center text-xs" style={{ color: '#9aa0bd' }}>
                  loading player…
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 text-center">
            <h1 className="font-display truncate text-xl font-semibold" style={{ color: 'var(--text-strong)' }}>
              {track?.title ?? '—'}
            </h1>
            <p className="mt-1 truncate text-sm" style={{ color: 'var(--text-muted)' }}>
              {track?.artist ?? ''}
            </p>
          </div>

          {/* Seek */}
          <div className="mt-5">
            <div onClick={seek} className="neu-inset h-3 cursor-pointer rounded-full" role="slider" aria-label="Seek" aria-valuenow={Math.round(progress)}>
              <div className="relative h-full rounded-full" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--accent-soft), var(--accent))' }}>
                <span className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full" style={{ background: 'var(--panel)', boxShadow: '2px 2px 5px var(--sh-dark), -2px -2px 5px var(--sh-light)' }} />
              </div>
            </div>
            <div className="mt-2 flex justify-between text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              <span>{fmt(time)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          {/* Transport + repeat */}
          <div className="mt-5 flex items-center justify-center gap-5">
            <IconButton label="Previous" onClick={() => advance(-1)} size={44}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 6h2v12H7zM20 6v12l-9-6z" /></svg>
            </IconButton>
            <button aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} className="accent-btn grid h-[68px] w-[68px] place-items-center rounded-full">
              {playing ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <IconButton label="Next" onClick={() => advance(1)} size={44}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6h2v12h-2zM4 6l9 6-9 6z" /></svg>
            </IconButton>
          </div>

          {/* Repeat control */}
          <div className="mt-4 flex justify-center">
            <button
              onClick={cycleRepeat}
              aria-label={`Repeat: ${repeat}`}
              className={`neu-btn flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${repeat !== 'off' ? 'is-pressed' : ''}`}
              style={{ color: repeat === 'off' ? 'var(--text-muted)' : 'var(--accent)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 2l4 4-4 4" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <path d="M7 22l-4-4 4-4" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              {repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
            </button>
          </div>

          {/* Volume */}
          <div className="mt-5 flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-muted)' }}>
              <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
              <path d="M16 8.5a4 4 0 0 1 0 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <div className="neu-inset relative h-2.5 flex-1 rounded-full">
              <div className="h-full rounded-full" style={{ width: `${volume}%`, background: 'linear-gradient(90deg, var(--accent-soft), var(--accent))' }} />
              <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </div>
          </div>
        </section>

        {/* Playlist ---------------------------------------------- */}
        <section className="neu rounded-[2rem] p-6">
          <div className={`neu-inset flex items-center gap-2 rounded-2xl px-4 py-2.5 ${addError ? 'ring-2 ring-red-300' : ''}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-muted)' }}>
              <rect x="2.5" y="5.5" width="19" height="13" rx="4" stroke="currentColor" strokeWidth="2" />
              <path d="M10 9.5v5l4-2.5-4-2.5Z" fill="currentColor" />
            </svg>
            <input
              value={addValue}
              onChange={(e) => { setAddValue(e.target.value); setAddError(false) }}
              onKeyDown={(e) => e.key === 'Enter' && addTrack()}
              placeholder="Paste a YouTube link to add…"
              className="w-full bg-transparent text-sm"
              style={{ color: 'var(--text-strong)', fontSize: 16 }}
            />
            <button onClick={addTrack} className="accent-btn shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold">Add</button>
          </div>
          {addError && (
            <p className="mt-2 px-1 text-xs" style={{ color: '#e5788f' }}>That doesn't look like a YouTube link.</p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="accent-btn rounded-2xl px-4 py-2 text-sm font-semibold transition-transform duration-200 ease-out hover:-translate-y-0.5"
            >
              Search YouTube
            </button>
          </div>

          {searchOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
              <div className="absolute inset-0 modal-backdrop" onClick={() => setSearchOpen(false)} aria-hidden="true" />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="search-modal-title"
                className="modal-panel neu relative z-10 w-full max-w-2xl rounded-[2rem] p-6 shadow-2xl"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <p id="search-modal-title" className="text-sm font-semibold uppercase tracking-[0.35em] text-[var(--text-muted)]">
                      Search YouTube
                    </p>
                    <div className="neu-inset flex items-center gap-3 rounded-2xl px-4 py-2.5 flex-1 transition-all duration-200 ease-out focus-within:shadow-[0_0_0_3px_rgba(245,49,127,0.18)]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-muted)' }}>
                        <path d="M10 9.5v5l4-2.5-4-2.5Z" fill="currentColor" />
                        <rect x="2.5" y="5.5" width="19" height="13" rx="4" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value)
                          setSearchError('')
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && searchYouTube()}
                        placeholder="Search YouTube videos…"
                        className="w-full bg-transparent text-sm"
                        style={{ color: 'var(--text-strong)', fontSize: 16 }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSearchOpen(false)}
                    aria-label="Close search modal"
                    className="neu-btn h-11 w-11 rounded-full text-xl transition-transform duration-200 ease-out hover:-translate-y-0.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ×
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={searchYouTube}
                    disabled={!searchQuery.trim() || searchLoading}
                    className="accent-btn rounded-xl px-4 py-2 text-sm font-semibold w-full sm:w-auto"
                  >
                    {searchLoading ? 'Searching…' : 'Search'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('')
                      setSearchResults([])
                      setSearchError('')
                    }}
                    className="neu-btn rounded-xl px-4 py-2 text-sm font-semibold w-full sm:w-auto"
                  >
                    Clear
                  </button>
                </div>
                {searchError ? (
                  <p className="mt-3 px-4 text-xs" role="status" aria-live="polite" style={{ color: '#e5788f' }}>{searchError}</p>
                ) : null}
                <div className="mt-3 space-y-3 max-h-[60vh] overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <div className="neu-inset rounded-2xl px-4 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                      Search YouTube and tap Add to queue a video.
                    </div>
                  ) : (
                    searchResults.map((result) => {
                      const already = tracks.some((t) => t.id === result.id)
                      return (
                        <div
                          key={result.id}
                          className="neu-inset flex items-center gap-3 rounded-2xl px-3 py-3 transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(245,49,127,0.12)]"
                        >
                          <img
                            src={`https://i.ytimg.com/vi/${result.id}/mqdefault.jpg`}
                            alt=""
                            className="h-14 w-20 shrink-0 rounded-xl object-cover"
                            draggable={false}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
                              {result.title}
                            </p>
                            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                              {result.artist}
                            </p>
                          </div>
                          <button
                            onClick={() => addSearchResult(result)}
                            disabled={already}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold ${already ? 'neu-sm' : 'accent-btn'}`}
                            style={{ color: already ? 'var(--text-muted)' : 'var(--accent-contrast)' }}
                          >
                            {already ? 'Added' : 'Add'}
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="neu-inset mt-3 flex items-center gap-3 rounded-2xl px-4 py-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-muted)' }}>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your playlist…"
              className="w-full bg-transparent text-sm"
              style={{ color: 'var(--text-strong)', fontSize: 16 }}
            />
          </div>

          <p className="mt-3 px-1 text-[0.7rem]" style={{ color: 'var(--text-muted)' }}>
            Drag the ⠿ handle to reorder · swipe a song left to delete
          </p>

          <ul className="soft-scroll mt-2 max-h-[440px] space-y-3 overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <li className="neu-inset rounded-2xl px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Nothing here yet — paste a YouTube link above to add a song.
              </li>
            )}
            {filtered.map(({ t }) => (
              <TrackRow
                key={t.id}
                track={t}
                isCurrent={t.id === currentId}
                playing={playing}
                isDragging={dragId === t.id}
                onPlay={() => playTrack(t.id)}
                onDelete={() => deleteTrack(t.id)}
                onDragStart={() => startDrag(t.id)}
              />
            ))}
          </ul>
        </section>
      </main>

      <p className="mx-auto mt-6 max-w-5xl px-1 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Youtugtog streams through YouTube's official player — views and ads count normally.
      </p>
    </div>
  )
}
