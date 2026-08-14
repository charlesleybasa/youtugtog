import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { flushSync } from "react-dom"
import logoUrl from "./imports/ChatGPT_Image_Jul_30__2026__01_48_16_PM.png"
import SavedPlaylistsModal, {
  type SavedPlaylist,
} from "./components/SavedPlaylistsModal"
import { pickNextShuffledId } from "./shuffle"

/* --------------------------------------------------------------------- *
 * Youtugtog — "Tugtog Pinoy anytime".
 *
 * Playback runs through the OFFICIAL YouTube IFrame Player API. We never
 * extract or re-host audio streams — the real player stays mounted and
 * rendered the whole time, so views and ads count normally. "Audio only"
 * here is a presentation choice: the video surface is parked off-screen
 * behind the page while a circular cover-art disc drives the UI, and the
 * user can bring the video back at any time with the Video toggle.
 * --------------------------------------------------------------------- */

type Track = { id: string; title: string; artist: string }
type Repeat = "off" | "all" | "one"
type Theme = "system" | "light" | "dark"
type ToastState = {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

const STARTER: Track[] = [
  { id: "JGwWNGJdvx8", title: "Shape of You", artist: "Ed Sheeran" },
  {
    id: "OPf0YbXqDm0",
    title: "Uptown Funk",
    artist: "Mark Ronson ft. Bruno Mars",
  },
  {
    id: "kJQP7kiw5Fk",
    title: "Despacito",
    artist: "Luis Fonsi ft. Daddy Yankee",
  },
  {
    id: "RgKAFK5djSk",
    title: "See You Again",
    artist: "Wiz Khalifa ft. Charlie Puth",
  },
  { id: "hT_nvWreIhg", title: "Counting Stars", artist: "OneRepublic" },
  { id: "60ItHLz5WEA", title: "Faded", artist: "Alan Walker" },
  { id: "CevxZvSJLk8", title: "Roar", artist: "Katy Perry" },
  { id: "2Vv-BfVoq4g", title: "Perfect", artist: "Ed Sheeran" },
  { id: "YQHsXMglC9A", title: "Hello", artist: "Adele" },
]

const SEARCH_PROXY = "/api/search"
const STORE_KEY = "youtugtog:state:v2"
const LEGACY_STORE_KEY = "youtugtog:state:v1"

/* ---- Small helpers -------------------------------------------------- */

function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  const m = s.match(
    /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([a-zA-Z0-9_-]{11})/,
  )
  return m ? m[1] : null
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

/** YouTube's API returns HTML-escaped snippets ("Don&amp;#39;t"). Unescape them. */
function decodeEntities(value: string): string {
  if (!value.includes("&")) return value
  const el = document.createElement("textarea")
  el.innerHTML = value
  return el.value
}

const PENDING_TITLE = "Added from YouTube"

/**
 * Resolve a real title/channel for a pasted link via YouTube's public oEmbed
 * endpoint (no API key, CORS-enabled). Saved queues outlive the session now,
 * so a persisted "Added from YouTube" placeholder would be there forever.
 */
async function fetchVideoMeta(
  id: string,
): Promise<{ title: string; artist: string } | null> {
  try {
    const target = `https://www.youtube.com/watch?v=${id}`
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.title) return null
    return {
      title: decodeEntities(String(data.title)),
      artist: decodeEntities(String(data.author_name ?? "YouTube")),
    }
  } catch {
    return null
  }
}

const coverArt = (id: string) =>
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
const coverArtFallback = (id: string) =>
  `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
const rowThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

type Persisted = {
  tracks?: Track[]
  currentId?: string | null
  playlists?: SavedPlaylist[]
  volume?: number
  theme?: Theme
  /** Legacy pre-`theme` field, still read once so existing users keep their choice. */
  dark?: boolean
  repeat?: Repeat
  shuffle?: boolean
  keepAwake?: boolean
}

const THEME_LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
}
const THEME_ORDER: Theme[] = ["system", "light", "dark"]

/** Resolve the stored preference, migrating the old boolean if present. */
function initialTheme(saved: Persisted): Theme {
  if (
    saved.theme === "light" ||
    saved.theme === "dark" ||
    saved.theme === "system"
  ) {
    return saved.theme
  }
  if (typeof saved.dark === "boolean") return saved.dark ? "dark" : "light"
  return "system"
}

function loadPersisted(): Persisted {
  try {
    const raw =
      localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Persisted
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function loadSavedPlaylists(saved: Persisted): SavedPlaylist[] {
  if (!Array.isArray(saved.playlists)) return []
  return saved.playlists.filter(
    (playlist) =>
      playlist &&
      typeof playlist.id === "string" &&
      typeof playlist.name === "string" &&
      typeof playlist.savedAt === "string" &&
      Array.isArray(playlist.tracks) &&
      playlist.tracks.every(
        (track) =>
          track &&
          typeof track.id === "string" &&
          typeof track.title === "string" &&
          typeof track.artist === "string",
      ),
  )
}

function defaultPlaylistName(): string {
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date())
  return `My mix · ${date}`
}

const wakeSupported =
  typeof navigator !== "undefined" && "wakeLock" in navigator

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  )
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
    if (!document.getElementById("yt-iframe-api")) {
      const tag = document.createElement("script")
      tag.id = "yt-iframe-api"
      tag.src = "https://www.youtube.com/iframe_api"
      document.head.appendChild(tag)
    }
  })
}

/* ---- Icons (SVG only — never emoji) --------------------------------- */

const Icon = {
  Play: (p: { size?: number }) => (
    <svg
      width={p.size ?? 22}
      height={p.size ?? 22}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8.4 5.2a1 1 0 0 1 1.53-.85l8.2 5.15a1.77 1.77 0 0 1 0 3l-8.2 5.15a1 1 0 0 1-1.53-.85z" />
    </svg>
  ),
  Pause: (p: { size?: number }) => (
    <svg
      width={p.size ?? 22}
      height={p.size ?? 22}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6.5" y="4.5" width="4" height="15" rx="1.6" />
      <rect x="13.5" y="4.5" width="4" height="15" rx="1.6" />
    </svg>
  ),
  Prev: (p: { size?: number }) => (
    <svg
      width={p.size ?? 20}
      height={p.size ?? 20}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5" y="5.5" width="2.6" height="13" rx="1.3" />
      <path d="M19.5 7.1v9.8a1 1 0 0 1-1.53.85l-7.8-4.9a1 1 0 0 1 0-1.7l7.8-4.9a1 1 0 0 1 1.53.85z" />
    </svg>
  ),
  Next: (p: { size?: number }) => (
    <svg
      width={p.size ?? 20}
      height={p.size ?? 20}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="16.4" y="5.5" width="2.6" height="13" rx="1.3" />
      <path d="M4.5 7.1v9.8a1 1 0 0 0 1.53.85l7.8-4.9a1 1 0 0 0 0-1.7l-7.8-4.9a1 1 0 0 0-1.53.85z" />
    </svg>
  ),
  Repeat: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 11.5V10a4 4 0 0 1 4-4h13" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" />
    </svg>
  ),
  RepeatOne: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 11.5V10a4 4 0 0 1 4-4h13" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" />
      <path d="M11.4 10.6 12.8 9.8v4.6" strokeWidth="2.2" />
    </svg>
  ),
  Shuffle: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3.5 21 7l-4 3.5" />
      <path d="M17 13.5 21 17l-4 3.5" />
      <path d="M3 7h3.4c1.5 0 2.8.8 3.5 2.1l3.2 5.8c.7 1.3 2 2.1 3.5 2.1H21" />
      <path d="M3 17h3.4c1.5 0 2.8-.8 3.5-2.1l.7-1.3" />
      <path d="M13.4 9.4l.7-1.3C14.8 6.8 16.1 6 17.6 6H21" />
    </svg>
  ),
  Volume: (p: { size?: number; muted?: boolean }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      {p.muted ? (
        <path
          d="m16.5 9.5 5 5m0-5-5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d="M16.2 8.6a4.6 4.6 0 0 1 0 6.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M18.8 6a8 8 0 0 1 0 12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.55"
          />
        </>
      )}
    </svg>
  ),
  Search: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path
        d="m20 20-3.6-3.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  Link: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10.5 13.5a3.6 3.6 0 0 0 5.1 0l2.8-2.8a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M13.5 10.5a3.6 3.6 0 0 0-5.1 0l-2.8 2.8a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  ),
  Close: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6.5 6.5l11 11m0-11-11 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  Trash: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 6.5h17M9 6.5V4.6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.9M6.5 6.5l.9 13a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13" />
    </svg>
  ),
  Grip: (p: { size?: number }) => (
    <svg
      width={p.size ?? 14}
      height={(p.size ?? 14) * 1.42}
      viewBox="0 0 14 20"
      fill="currentColor"
      aria-hidden="true"
    >
      {[4, 10, 16].map((cy) =>
        [4, 10].map((cx) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />
        )),
      )}
    </svg>
  ),
  Video: (p: { size?: number; off?: boolean }) => (
    <svg
      width={p.size ?? 17}
      height={p.size ?? 17}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="5.5"
        width="19"
        height="13"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      {p.off ? (
        <path
          d="m4.5 4 15 16"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : (
        <path d="M10.2 9.4v5.2l4.4-2.6-4.4-2.6Z" fill="currentColor" />
      )}
    </svg>
  ),
  Sun: (p: { size?: number }) => (
    <svg
      width={p.size ?? 20}
      height={p.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2" />
      {[...Array(8)].map((_, i) => (
        <line
          key={i}
          x1="12"
          y1="1.8"
          x2="12"
          y2="4.2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  ),
  Moon: (p: { size?: number }) => (
    <svg
      width={p.size ?? 20}
      height={p.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Awake: (p: { size?: number }) => (
    <svg
      width={p.size ?? 16}
      height={p.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="6"
        y="2.5"
        width="12"
        height="19"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M12 6.8v4.4l2.6 1.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  System: (p: { size?: number }) => (
    <svg
      width={p.size ?? 20}
      height={p.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="4"
        width="19"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8.5 20.5h7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 17v3.5" stroke="currentColor" strokeWidth="2" />
      {/* half-filled screen = "follows your device" */}
      <path d="M12 6.2v8.6a4.3 4.3 0 0 0 0-8.6Z" fill="currentColor" />
    </svg>
  ),
  Library: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="7"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <rect
        x="14"
        y="4"
        width="7"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M6 8h1M17 8h1M6 16h1M17 16h1"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  ),
  Save: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 3.5h11l3 3V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M8 3.5v5h7v-5M8 21v-7h8v7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Check: (p: { size?: number }) => (
    <svg
      width={p.size ?? 16}
      height={p.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Plus: (p: { size?: number }) => (
    <svg
      width={p.size ?? 16}
      height={p.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  ),
}

/* ---- Primitives ----------------------------------------------------- */

function IconButton({
  children,
  onClick,
  size = 48,
  label,
  pressed,
  title,
  sizeClass,
  /** Responsive sizing classes; when set, overrides the fixed `size` px. */
}: {
  children: ReactNode
  onClick?: () => void
  size?: number
  label: string
  pressed?: boolean
  title?: string
  sizeClass?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      onClick={onClick}
      className={`neu-btn grid shrink-0 place-items-center rounded-full ${
        sizeClass ?? ""
      } ${pressed ? "is-pressed" : ""}`}
      style={{
        ...(sizeClass ? null : { width: size, height: size }),
        color: pressed ? "var(--accent-text)" : "var(--text)",
      }}
    >
      {children}
    </button>
  )
}

function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

/**
 * Pointer + keyboard slider. Used for both seek and volume so the two
 * behave identically (drag anywhere on the track, arrows to nudge,
 * Home/End to jump), and both expose a real `slider` role.
 */
function Slider({
  value,
  max,
  onPreview,
  onCommit,
  label,
  valueText,
  height = 10,
  disabled,
  step,
}: {
  value: number
  max: number
  onPreview?: (v: number) => void
  onCommit: (v: number) => void
  label: string
  valueText: string
  height?: number
  disabled?: boolean
  step?: number
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const scrubbingRef = useRef(false)
  const [scrubbing, setScrubbing] = useState(false)
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0
  const stepSize = step ?? Math.max(1, max / 20)

  const valueFromEvent = (clientX: number) => {
    const el = trackRef.current
    if (!el || max <= 0) return 0
    const rect = el.getBoundingClientRect()
    return clamp((clientX - rect.left) / rect.width, 0, 1) * max
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || max <= 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbingRef.current = true
    setScrubbing(true)
    onPreview?.(valueFromEvent(e.clientX))
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    onPreview?.(valueFromEvent(e.clientX))
  }

  const endScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    setScrubbing(false)
    onCommit(valueFromEvent(e.clientX))
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || max <= 0) return
    let next: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + stepSize
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown")
      next = value - stepSize
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = max
    else if (e.key === "PageUp") next = value + stepSize * 2
    else if (e.key === "PageDown") next = value - stepSize * 2
    if (next === null) return
    e.preventDefault()
    onCommit(clamp(next, 0, max))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onKeyDown={onKeyDown}
      className={`neu-inset slider-track ${scrubbing ? "is-scrubbing" : ""}`}
      style={{ height, opacity: disabled ? 0.55 : 1, ["--pct" as string]: pct }}
    >
      <div className="slider-fill" />
      <span className="slider-thumb" />
    </div>
  )
}

/* ---- Circular cover ------------------------------------------------- */

function CircularCover({
  trackId,
  playing,
  progress,
  ready,
}: {
  trackId: string | undefined
  playing: boolean
  progress: number
  ready: boolean
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setSrc(trackId ? coverArt(trackId) : null)
  }, [trackId])

  // r is in viewBox units; the ring sits just inside the 100x100 box.
  const R = 47
  const circumference = 2 * Math.PI * R
  const offset = circumference * (1 - clamp(progress, 0, 100) / 100)

  return (
    <div className={`disc-wrap ${playing ? "is-playing" : ""}`}>
      <span className="disc-halo" />

      <svg className="disc-ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id="discGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-soft)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle
          className="disc-ring__track"
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="2.5"
        />
        <circle
          className="disc-ring__value"
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>

      <div className="disc-plate">
        <div className="disc-groove">
          {(!loaded || !ready) && (
            <span className="disc-skeleton" aria-hidden="true" />
          )}
          {src && (
            <img
              key={src}
              src={src}
              alt=""
              draggable={false}
              className="disc-art"
              style={{ opacity: loaded ? 1 : 0 }}
              onLoad={(e) => {
                // maxresdefault 404s render as a 120x90 grey placeholder.
                if (e.currentTarget.naturalWidth <= 120 && trackId) {
                  setSrc(coverArtFallback(trackId))
                  return
                }
                setLoaded(true)
              }}
              onError={() => {
                if (trackId && src !== coverArtFallback(trackId))
                  setSrc(coverArtFallback(trackId))
              }}
            />
          )}
          <span className="disc-sheen" aria-hidden="true" />
          <span className="disc-spindle" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

/* ---- Playlist row: swipe-to-delete + drag/keyboard reorder ---------- */

function TrackRow({
  track,
  index,
  isCurrent,
  playing,
  isDragging,
  onPlay,
  onDelete,
  onDragStart,
  onMoveBy,
}: {
  track: Track
  index: number
  isCurrent: boolean
  playing: boolean
  isDragging: boolean
  onPlay: () => void
  onDelete: () => void
  onDragStart: () => void
  onMoveBy: (delta: number) => void
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
      setDx(Math.max(-140, Math.min(0, diffX)))
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
  const revealed = clamp(-dx / 96, 0, 1)

  return (
    <li
      data-track-id={track.id}
      className="row-hover rise-in relative overflow-hidden rounded-2xl"
      style={{
        ["--i" as string]: Math.min(index, 12),
        opacity: isDragging ? 0.45 : 1,
      }}
    >
      {/* Delete affordance — only painted while a swipe is in progress, so it
          can never bleed along the row edge at rest. */}
      {dx < 0 && (
        <div
          className="absolute inset-0 flex items-center justify-end rounded-2xl pr-6 text-white"
          style={{ background: "linear-gradient(90deg, #ff8a2b, #f5317f)" }}
          aria-hidden="true"
        >
          <span
            style={{
              transform: `scale(${0.7 + revealed * 0.45})`,
              transition: "transform 120ms",
            }}
          >
            <Icon.Trash size={20} />
          </span>
        </div>
      )}

      <div
        className={`swipe-row ${swiping ? "dragging" : ""} ${
          isCurrent ? "neu-inset" : "neu-sm"
        } flex items-center gap-1.5 rounded-2xl py-2.5 pl-1.5 pr-2 sm:gap-2 sm:pl-2 sm:pr-3`}
        style={{
          transform: `translateX(${dx}px)`,
          ...(isDragging ? { boxShadow: "0 12px 30px var(--art-glow)" } : {}),
        }}
        onPointerDown={onDown}
        onPointerMove={onMovePtr}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <button
          type="button"
          aria-label={`Reorder ${track.title}. Use arrow up and arrow down to move.`}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onDragStart()
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault()
              onMoveBy(-1)
            } else if (e.key === "ArrowDown") {
              e.preventDefault()
              onMoveBy(1)
            }
          }}
          className="grid h-11 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg active:cursor-grabbing"
          style={{ color: "var(--text-muted)" }}
        >
          <Icon.Grip />
        </button>

        <button
          type="button"
          onClick={onClick}
          aria-label={`${
            isPlayingThis ? "Pause" : "Play"
          } ${track.title} by ${track.artist}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1 text-left"
        >
          <span className="relative shrink-0">
            <img
              src={rowThumb(track.id)}
              alt=""
              loading="lazy"
              decoding="async"
              width={64}
              height={48}
              draggable={false}
              className="h-12 w-16 rounded-xl object-cover"
              style={{ background: "var(--sh-dark)" }}
            />
            {isPlayingThis && (
              <span
                className="absolute inset-0 grid place-items-center rounded-xl"
                style={{ background: "rgba(12,14,28,0.5)", color: "#fff" }}
              >
                <Equalizer />
              </span>
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-semibold"
              style={{
                color: isCurrent ? "var(--accent-text)" : "var(--text-strong)",
              }}
            >
              {track.title}
            </span>
            <span
              className="mt-0.5 block truncate text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {track.artist}
            </span>
          </span>

          {/* Decorative — the whole row is the play target, and state is
              already carried by the accent title, the inset shadow and the
              equalizer badge. It only earns its width once there is room. */}
          <span
            className={`hidden h-10 w-10 shrink-0 place-items-center rounded-full sm:grid ${
              isCurrent ? "accent-btn" : "neu-sm"
            }`}
            style={{ color: isCurrent ? "#fff" : "var(--text-muted)" }}
            aria-hidden="true"
          >
            {isPlayingThis ? <Icon.Pause size={14} /> : <Icon.Play size={14} />}
          </span>
        </button>

        <button
          type="button"
          aria-label={`Remove ${track.title} from the queue`}
          onClick={onDelete}
          className="grid h-11 w-9 shrink-0 cursor-pointer place-items-center rounded-full"
          style={{ color: "var(--text-muted)" }}
        >
          <Icon.Close size={15} />
        </button>
      </div>
    </li>
  )
}

/* ---- Search modal --------------------------------------------------- */

function SearchModal({
  open,
  onClose,
  query,
  setQuery,
  onSearch,
  loading,
  error,
  results,
  isQueued,
  onAdd,
  onPlay,
  inputRef,
  /** Owned by App so the opener can focus it inside the click gesture. */
}: {
  open: boolean
  onClose: () => void
  query: string
  setQuery: (v: string) => void
  onSearch: () => void
  loading: boolean
  error: string
  results: Track[]
  isQueued: (id: string) => boolean
  onAdd: (t: Track) => void
  onPlay: (t: Track) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The bottom-sheet must track the *visual* viewport: iOS shrinks it when
  // the soft keyboard opens but leaves fixed/layout-viewport elements at
  // full height, which would leave the sheet stranded behind the keyboard.
  const [viewport, setViewport] = useState<{
    top: number
    height: number
  } | null>(null)

  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setViewport({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
      setViewport(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    // Fallback only: openSearch() already focuses synchronously. Focus
    // restoration on close is handled by App, which knows the trigger.
    const focusTimer = window.setTimeout(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus()
    }, 60)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [open, onClose, inputRef])

  if (!open) return null

  return (
    <div
      className="fixed left-0 right-0 z-50 flex items-end justify-center px-3 py-3 sm:items-center sm:px-4 sm:py-6"
      style={
        viewport
          ? { top: viewport.top, height: viewport.height }
          : { top: 0, height: "100%" }
      }
    >
      <div
        className="modal-backdrop absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-modal-title"
        className="modal-panel neu safe-b relative z-10 flex max-h-full w-full max-w-2xl flex-col rounded-[1.75rem] p-4 sm:rounded-[2rem] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              id="search-modal-title"
              className="font-display text-[0.68rem] font-bold uppercase tracking-[0.32em]"
              style={{ color: "var(--text-muted)" }}
            >
              Search YouTube
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Add anything to your queue — it plays as audio.
            </p>
          </div>
          <IconButton label="Close search" onClick={onClose} size={44}>
            <Icon.Close size={18} />
          </IconButton>
        </div>

        <div className="neu-inset mt-4 flex items-center gap-3 rounded-2xl px-4 py-3">
          <span style={{ color: "var(--text-muted)" }}>
            <Icon.Search />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch()
            }}
            placeholder="Songs, artists, albums…"
            enterKeyHint="search"
            className="w-full min-w-0 bg-transparent text-sm"
            style={{ color: "var(--text-strong)" }}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onSearch}
            disabled={!query.trim() || loading}
            className="accent-btn flex-1 rounded-xl px-4 py-3 text-sm font-bold sm:flex-none sm:px-6"
          >
            {loading ? "Searching…" : "Search"}
          </button>
          <button
            type="button"
            onClick={() => setQuery("")}
            disabled={!query}
            className="neu-btn rounded-xl px-4 py-3 text-sm font-bold sm:px-6"
          >
            Clear
          </button>
        </div>

        {error && (
          <p
            className="neu-inset mt-3 rounded-xl px-4 py-3 text-xs leading-relaxed"
            role="status"
            aria-live="polite"
            style={{ color: "var(--danger)" }}
          >
            {error}
          </p>
        )}

        <div className="soft-scroll -mx-1 mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-1">
          {loading &&
            [0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="neu-inset flex items-center gap-3 rounded-2xl px-3 py-3"
                aria-hidden="true"
                style={{ opacity: 1 - i * 0.18 }}
              >
                <span
                  className="skeleton h-14 w-20 shrink-0"
                  style={{ borderRadius: 12 }}
                />
                <span className="flex-1 space-y-2">
                  <span
                    className="skeleton h-3 w-3/4"
                    style={{ borderRadius: 999 }}
                  />
                  <span
                    className="skeleton h-2.5 w-1/3"
                    style={{ borderRadius: 999 }}
                  />
                </span>
              </div>
            ))}

          {!loading && results.length === 0 && !error && (
            <div
              className="neu-inset rounded-2xl px-5 py-8 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              Search for a song, then add it to your queue.
            </div>
          )}

          {!loading &&
            results.map((result, i) => {
              const already = isQueued(result.id)
              return (
                <div
                  key={result.id}
                  className="rise-in neu-inset flex items-center gap-3 rounded-2xl px-3 py-2.5"
                  style={{ ["--i" as string]: i }}
                >
                  <img
                    src={rowThumb(result.id)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={80}
                    height={56}
                    className="h-14 w-20 shrink-0 rounded-xl object-cover"
                    style={{ background: "var(--sh-dark)" }}
                    draggable={false}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="line-clamp-2 text-sm font-semibold"
                      style={{ color: "var(--text-strong)" }}
                    >
                      {result.title}
                    </p>
                    <p
                      className="mt-0.5 truncate text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {result.artist}
                    </p>
                  </div>
                  {already ? (
                    <button
                      type="button"
                      onClick={() => onPlay(result)}
                      aria-label={`Play ${result.title}`}
                      className="neu-btn grid h-11 w-11 shrink-0 place-items-center rounded-full"
                      style={{ color: "var(--accent-text)" }}
                    >
                      <Icon.Play size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAdd(result)}
                      aria-label={`Add ${result.title} to the queue`}
                      className="accent-btn grid h-11 w-11 shrink-0 place-items-center rounded-full"
                    >
                      <Icon.Plus size={18} />
                    </button>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

/* ---- Sticky mini player (mobile) ------------------------------------ */

function MiniPlayer({
  track,
  playing,
  progress,
  onToggle,
  onNext,
  onPrev,
  onExpand,
}: {
  track: Track | undefined
  playing: boolean
  progress: number
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onExpand: () => void
}) {
  if (!track) return null
  return (
    <div className="mini-player fixed inset-x-0 bottom-0 z-40 px-3 pb-3 lg:hidden">
      <div
        className="neu flex items-center gap-2 rounded-2xl p-2 pr-2.5"
        style={{ background: "var(--panel-raised)" }}
      >
        <button
          type="button"
          onClick={onExpand}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
          aria-label={`Now playing ${track.title}. Scroll to the player.`}
        >
          <span className="relative grid h-11 w-11 shrink-0 place-items-center">
            <svg
              viewBox="0 0 40 40"
              className="absolute inset-0 h-full w-full -rotate-90"
              aria-hidden="true"
            >
              <circle
                cx="20"
                cy="20"
                r="18.5"
                fill="none"
                stroke="var(--sh-dark)"
                strokeWidth="2"
              />
              <circle
                cx="20"
                cy="20"
                r="18.5"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 18.5}
                strokeDashoffset={
                  2 * Math.PI * 18.5 * (1 - clamp(progress, 0, 100) / 100)
                }
              />
            </svg>
            <img
              src={rowThumb(track.id)}
              alt=""
              className={`mini-art h-8 w-8 ${playing ? "is-spinning" : ""}`}
              draggable={false}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-[0.8rem] font-semibold"
              style={{ color: "var(--text-strong)" }}
            >
              {track.title}
            </span>
            <span
              className="block truncate text-[0.7rem]"
              style={{ color: "var(--text-muted)" }}
            >
              {track.artist}
            </span>
          </span>
        </button>

        <IconButton label="Previous track" onClick={onPrev} size={44}>
          <Icon.Prev size={17} />
        </IconButton>
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
          className="accent-btn grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full"
        >
          {playing ? <Icon.Pause size={18} /> : <Icon.Play size={18} />}
        </button>
        <IconButton label="Next track" onClick={onNext} size={44}>
          <Icon.Next size={17} />
        </IconButton>
      </div>
    </div>
  )
}

/* ---- Toast ---------------------------------------------------------- */

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastState | null
  onDismiss: () => void
}) {
  // Keyed on the toast id only: the position poll re-renders App ~4x a
  // second, and depending on `toast`/`onDismiss` identity would restart this
  // timer every tick, so the toast would never auto-dismiss.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const toastId = toast?.id
  useEffect(() => {
    if (!toastId) return
    const t = window.setTimeout(() => dismissRef.current(), 4500)
    return () => window.clearTimeout(t)
  }, [toastId])

  if (!toast) return null
  return (
    <div
      className="toast neu fixed bottom-24 left-1/2 z-[60] flex w-max max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 lg:bottom-6"
      style={{ background: "var(--panel-raised)" }}
      role="status"
      aria-live="polite"
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
        style={{ background: "var(--accent-fill)", color: "#fff" }}
      >
        <Icon.Check size={14} />
      </span>
      <span
        className="truncate text-sm font-medium"
        style={{ color: "var(--text-strong)" }}
      >
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run()
            onDismiss()
          }}
          className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-sm font-bold"
          style={{ color: "var(--accent-text)" }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

/* ===================================================================== *
 * App
 * ===================================================================== */

export default function App() {
  const [saved] = useState<Persisted>(loadPersisted)

  const [theme, setTheme] = useState<Theme>(() => initialTheme(saved))
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)
  // "system" tracks the OS live, so a device switching to night mode is
  // reflected without a reload; an explicit light/dark choice always wins.
  const dark = theme === "system" ? systemDark : theme === "dark"
  // Array.isArray, not `.length`: an empty saved queue is a deliberate user
  // state ("I deleted everything"), not a missing one. Using truthiness here
  // resurrected the starter list on the next visit.
  const [tracks, setTracks] = useState<Track[]>(
    Array.isArray(saved.tracks) ? saved.tracks : STARTER,
  )
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>(() =>
    loadSavedPlaylists(saved),
  )
  const [query, setQuery] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const [playlistsView, setPlaylistsView] = useState<"library" | "save">(
    "library",
  )
  const [playlistDefaultName, setPlaylistDefaultName] =
    useState(defaultPlaylistName)
  const [addValue, setAddValue] = useState("")
  const [addError, setAddError] = useState("")
  const [currentId, setCurrentId] = useState<string | null>(
    saved.currentId &&
      (saved.tracks ?? STARTER).some((t) => t.id === saved.currentId)
      ? saved.currentId
      : ((Array.isArray(saved.tracks) ? saved.tracks[0]?.id : STARTER[0].id) ??
          null),
  )
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [ready, setReady] = useState(false)
  const [time, setTime] = useState(0)
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState<number>(saved.volume ?? 80)
  const [muted, setMuted] = useState(false)
  const [keepAwake, setKeepAwake] = useState<boolean>(saved.keepAwake ?? false)
  const [repeat, setRepeat] = useState<Repeat>(saved.repeat ?? "off")
  const [shuffle, setShuffle] = useState<boolean>(saved.shuffle ?? false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [showVideo, setShowVideo] = useState(false)
  const [showMini, setShowMini] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const playerRef = useRef<any>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<HTMLDivElement | null>(null)
  const playerCardRef = useRef<HTMLElement | null>(null)
  const tick = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // What the *user* asked for. `playing` mirrors the YouTube player, which a
  // backgrounding browser can flip to paused on its own; this does not move.
  const intendedPlayRef = useRef(false)
  const wakeLockRef = useRef<any>(null)
  const searchTriggerRef = useRef<HTMLElement | null>(null)
  const playlistsTriggerRef = useRef<HTMLElement | null>(null)
  const toastSeq = useRef(0)
  // Tracks selected during the current shuffle cycle. Keeping this separate
  // from React state lets consecutive player events update it synchronously.
  const shufflePlayedRef = useRef<Set<string>>(new Set())

  const currentIdx = currentId
    ? tracks.findIndex((candidate) => candidate.id === currentId)
    : -1
  const track = currentIdx >= 0 ? tracks[currentIdx] : undefined
  const displayTime = scrubTime ?? time
  const progress = duration ? (displayTime / duration) * 100 : 0

  const notify = useCallback(
    (message: string, action?: ToastState["action"]) => {
      toastSeq.current += 1
      setToast({ id: toastSeq.current, message, action })
    },
    [],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tracks
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
    )
  }, [tracks, query])

  /* ---- theme ---- */
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
    if (!mq) return
    setSystemDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#1a1e27" : "#e4e8f4")
  }, [dark])

  /* ---- persistence ---- */
  useEffect(() => {
    const payload: Persisted = {
      tracks,
      currentId,
      playlists: savedPlaylists,
      volume,
      theme,
      repeat,
      shuffle,
      keepAwake,
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload))
    } catch {
      /* storage full or blocked — playback is unaffected */
    }
  }, [
    tracks,
    currentId,
    savedPlaylists,
    volume,
    theme,
    repeat,
    shuffle,
    keepAwake,
  ])

  /* live refs so the YT event handlers always see fresh state */
  const stateRef = useRef({ tracks, currentId, repeat, shuffle })
  useEffect(() => {
    stateRef.current = { tracks, currentId, repeat, shuffle }
  }, [tracks, currentId, repeat, shuffle])

  // Turning shuffle on starts a fresh cycle from the current song. Turning it
  // off discards the cycle so a later shuffle session does not inherit it.
  useEffect(() => {
    shufflePlayedRef.current.clear()
    if (shuffle && currentId) shufflePlayedRef.current.add(currentId)
  }, [shuffle])

  const advance = useCallback((delta: number) => {
    const { tracks: ts, currentId: cid, shuffle: sh } = stateRef.current
    if (!ts.length) return
    const idx = ts.findIndex((t) => t.id === cid)
    let nextIdx: number
    if (idx < 0) {
      nextIdx = delta < 0 ? ts.length - 1 : 0
    } else if (sh && ts.length > 1) {
      const nextId = pickNextShuffledId(
        ts.map((item) => item.id),
        cid,
        shufflePlayedRef.current,
      )
      nextIdx = ts.findIndex((item) => item.id === nextId)
    } else {
      nextIdx = (((idx + delta) % ts.length) + ts.length) % ts.length
    }
    const nextId = ts[nextIdx].id
    // Keep player callbacks current even if another event arrives before the
    // state-syncing effect runs.
    stateRef.current = { ...stateRef.current, currentId: nextId }
    setCurrentId(nextId)
    intendedPlayRef.current = true
    setPlaying(true)
  }, [])

  const handleEnded = useCallback(() => {
    const {
      tracks: ts,
      currentId: cid,
      repeat: rp,
      shuffle: sh,
    } = stateRef.current
    const idx = ts.findIndex((t) => t.id === cid)
    if (rp === "one") {
      playerRef.current?.seekTo?.(0, true)
      playerRef.current?.playVideo?.()
      return
    }
    if (!sh && idx === ts.length - 1 && rp === "off") {
      intendedPlayRef.current = false
      setPlaying(false)
      return
    }
    advance(1)
  }, [advance])

  /* ---- build the player once ---- */
  useEffect(() => {
    let killed = false
    loadYouTubeApi().then((YT) => {
      if (killed || !mountRef.current) return
      playerRef.current = new YT.Player(mountRef.current, {
        videoId: currentId ?? undefined,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e: any) => {
            e.target.setVolume(volume)
            setReady(true)
          },
          onStateChange: (e: any) => {
            const S = window.YT.PlayerState
            setBuffering(e.data === S.BUFFERING)
            if (e.data === S.PLAYING) setPlaying(true)
            else if (e.data === S.PAUSED) setPlaying(false)
            else if (e.data === S.ENDED) handleEnded()
          },
          onError: () => {
            notify("That video can’t be played here. Skipping…")
            handleEnded()
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

  /* ---- poll position while playing ---- */
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

  /* ---- load new video when the current track changes ---- */
  const didInit = useRef(false)
  useEffect(() => {
    const p = playerRef.current
    if (!ready || !p || !track) return
    if (!didInit.current) {
      // First ready: cue paused. Never autoplay on load.
      didInit.current = true
      p.cueVideoById(track.id)
      return
    }
    if (intendedPlayRef.current) p.loadVideoById(track.id)
    else p.cueVideoById(track.id)
    setTime(0)
    setScrubTime(null)
    setDuration(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p?.setVolume) return
    p.setVolume(muted ? 0 : volume)
  }, [volume, muted])

  const toggle = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (playing) {
      intendedPlayRef.current = false
      p.pauseVideo()
    } else {
      intendedPlayRef.current = true
      p.playVideo()
    }
  }, [playing])

  const seekTo = useCallback((seconds: number) => {
    const p = playerRef.current
    if (!p?.seekTo) return
    p.seekTo(seconds, true)
    setTime(seconds)
    setScrubTime(null)
  }, [])

  /* ---- OS / lock-screen media controls (the "background" experience) ---- */
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: "Youtugtog",
        artwork: [
          { src: rowThumb(track.id), sizes: "320x180", type: "image/jpeg" },
          { src: coverArt(track.id), sizes: "1280x720", type: "image/jpeg" },
        ],
      })
    } catch {
      /* MediaMetadata unsupported */
    }
  }, [track])

  useEffect(() => {
    if (!("mediaSession" in navigator)) return
    const ms = navigator.mediaSession
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> =
      [
        ["play", () => playerRef.current?.playVideo?.()],
        ["pause", () => playerRef.current?.pauseVideo?.()],
        ["previoustrack", () => advance(-1)],
        ["nexttrack", () => advance(1)],
        [
          "seekbackward",
          () =>
            seekTo(
              Math.max(0, (playerRef.current?.getCurrentTime?.() ?? 0) - 10),
            ),
        ],
        [
          "seekforward",
          () => seekTo((playerRef.current?.getCurrentTime?.() ?? 0) + 10),
        ],
        ["seekto", (d) => typeof d.seekTime === "number" && seekTo(d.seekTime)],
      ]
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* action unsupported in this browser */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [advance, seekTo])

  useEffect(() => {
    if (!("mediaSession" in navigator)) return
    navigator.mediaSession.playbackState = playing ? "playing" : "paused"
    if (!duration || !Number.isFinite(duration)) return
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: clamp(time, 0, duration),
        playbackRate: 1,
      })
    } catch {
      /* position state unsupported */
    }
  }, [playing, time, duration])

  /* ---- staying alive in the background -----------------------------
   * Mobile browsers suspend media for a backgrounded or locked page, and
   * YouTube embeds are no exception — that is an OS policy a web page
   * cannot opt out of. Two things are actually within reach:
   *   1. an optional Screen Wake Lock, so the device stops auto-locking
   *      mid-song in the first place;
   *   2. resuming automatically when the user comes back, instead of
   *      leaving them on a silently paused player.
   */
  const releaseWakeLock = useCallback(() => {
    try {
      wakeLockRef.current?.release?.()
    } catch {
      /* already released by the browser */
    }
    wakeLockRef.current = null
  }, [])

  const acquireWakeLock = useCallback(async () => {
    if (!wakeSupported || wakeLockRef.current) return
    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request("screen")
      wakeLockRef.current?.addEventListener?.("release", () => {
        wakeLockRef.current = null
      })
    } catch {
      /* denied (low battery, not user-activated) — playback is unaffected */
    }
  }, [])

  useEffect(() => {
    if (keepAwake && playing) void acquireWakeLock()
    else releaseWakeLock()
  }, [keepAwake, playing, acquireWakeLock, releaseWakeLock])

  useEffect(() => releaseWakeLock, [releaseWakeLock])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      if (keepAwake && intendedPlayRef.current) void acquireWakeLock()
      const p = playerRef.current
      // 2 === PAUSED. Only resume if the pause came from the browser, not
      // from the user deliberately pausing before switching away.
      if (intendedPlayRef.current && p?.getPlayerState?.() === 2) {
        p.playVideo?.()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [keepAwake, acquireWakeLock])

  /* ---- show the mini player once the real transport scrolls away ---- */
  useEffect(() => {
    const el = transportRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      ([entry]) => setShowMini(!entry.isIntersecting),
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* ---- search modal open/close ----------------------------------- *
   * iOS only raises the soft keyboard when .focus() runs inside the user
   * gesture. flushSync commits the modal to the DOM synchronously so the
   * input exists and can be focused before the tap handler returns. */
  const openSearch = useCallback(() => {
    searchTriggerRef.current = (document.activeElement as HTMLElement | null)
    setPlaylistsOpen(false)
    flushSync(() => setSearchOpen(true))
    searchInputRef.current?.focus({ preventScroll: true })
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    const trigger = searchTriggerRef.current
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus?.())
  }, [])

  const openPlaylists = useCallback(
    (view: "library" | "save", preserveTrigger = false) => {
      if (!preserveTrigger) {
        playlistsTriggerRef.current = document.activeElement as HTMLElement | null
      }
      setSearchOpen(false)
      setPlaylistDefaultName(defaultPlaylistName())
      setPlaylistsView(view)
      setPlaylistsOpen(true)
    },
    [],
  )

  const closePlaylists = useCallback(() => {
    setPlaylistsOpen(false)
    const trigger = playlistsTriggerRef.current
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus?.())
  }, [])

  /* ---- global keyboard shortcuts ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]',
        )
      )
        return
      if (searchOpen || playlistsOpen) return
      if (e.key === " " || e.key === "k") {
        e.preventDefault()
        toggle()
      } else if (e.key === "ArrowRight" && e.shiftKey) advance(1)
      else if (e.key === "ArrowLeft" && e.shiftKey) advance(-1)
      else if (e.key === "m") setMuted((m) => !m)
      else if (e.key === "/") {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle, advance, searchOpen, playlistsOpen, openSearch])

  /* ---- queue operations ---- */

  const playTrack = (id: string) => {
    if (id === currentId) {
      toggle()
      return
    }
    setCurrentId(id)
    intendedPlayRef.current = true
    setPlaying(true)
    playerRef.current?.playVideo?.()
  }

  const deleteTrack = (id: string) => {
    const index = tracks.findIndex((t) => t.id === id)
    const removed = tracks[index]
    if (!removed) return
    const wasCurrent = id === currentId
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (id === currentId && next.length) {
        setCurrentId(next[Math.min(index, next.length - 1)].id)
      } else if (id === currentId) {
        intendedPlayRef.current = false
        playerRef.current?.stopVideo?.()
        setCurrentId(null)
        setPlaying(false)
        setTime(0)
        setScrubTime(null)
        setDuration(0)
      }
      return next
    })
    notify(`Removed “${removed.title}”`, {
      label: "Undo",
      run: () =>
        setTracks((prev) => {
          if (prev.some((t) => t.id === removed.id)) return prev
          const next = [...prev]
          next.splice(Math.min(index, next.length), 0, removed)
          if (wasCurrent) setCurrentId(removed.id)
          return next
        }),
    })
  }

  const moveTrack = (id: string, delta: number) => {
    setTracks((prev) => {
      const from = prev.findIndex((t) => t.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  /** Patch a queued track in place once its real metadata arrives. */
  const resolveTrackMeta = useCallback(async (id: string) => {
    const meta = await fetchVideoMeta(id)
    if (!meta) {
      const markUnavailable = (track: Track) =>
        track.id === id && track.title === PENDING_TITLE
          ? { ...track, artist: "Tap to play" }
          : track
      setTracks((prev) => prev.map(markUnavailable))
      setSavedPlaylists((prev) =>
        prev.map((playlist) => ({
          ...playlist,
          tracks: playlist.tracks.map(markUnavailable),
        })),
      )
      return
    }
    const applyMeta = (track: Track) =>
      track.id === id ? { ...track, ...meta } : track
    setTracks((prev) => prev.map(applyMeta))
    setSavedPlaylists((prev) =>
      prev.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map(applyMeta),
      })),
    )
  }, [])

  // Backfill anything saved before its title resolved (offline at the time,
  // or added by an older build that never fetched metadata).
  useEffect(() => {
    const pending = [
      ...new Set(
        [...tracks, ...savedPlaylists.flatMap((playlist) => playlist.tracks)]
          .filter((track) => track.title === PENDING_TITLE)
          .map((track) => track.id),
      ),
    ]
    if (!pending.length) return
    let cancelled = false
    void (async () => {
      for (const id of pending) {
        if (cancelled) return
        await resolveTrackMeta(id)
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs on mount only; newly added tracks resolve via addTrack directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addTrack = () => {
    const id = parseVideoId(addValue)
    if (!id) {
      setAddError("That doesn’t look like a YouTube link or video ID.")
      return
    }
    setAddError("")
    setAddValue("")
    if (tracks.some((t) => t.id === id)) {
      notify("Already in your queue")
      return
    }
    setTracks((prev) => [
      ...prev,
      { id, title: PENDING_TITLE, artist: "Fetching details…" },
    ])
    if (!tracks.length) setCurrentId(id)
    notify("Added to the end of your queue")
    void resolveTrackMeta(id)
  }

  const addSearchResult = (result: Track) => {
    if (tracks.some((t) => t.id === result.id)) return
    setTracks((prev) => [...prev, result])
    if (!tracks.length) setCurrentId(result.id)
    notify(`Queued “${result.title}”`)
  }

  const playSearchResult = (result: Track) => {
    if (!tracks.some((t) => t.id === result.id))
      setTracks((prev) => [...prev, result])
    setCurrentId(result.id)
    intendedPlayRef.current = true
    setPlaying(true)
    setSearchOpen(false)
  }

  const saveCurrentQueue = (name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName || !tracks.length) return
    const playlist: SavedPlaylist = {
      id:
        globalThis.crypto?.randomUUID?.() ??
        `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      tracks: tracks.map((item) => ({ ...item })),
      savedAt: new Date().toISOString(),
    }
    setSavedPlaylists((prev) => [playlist, ...prev])
    closePlaylists()
    notify(`Saved “${trimmedName}”`, {
      label: "View",
      // Keep the durable Save queue opener as the focus-return target; the
      // toast action unmounts as soon as it opens the modal.
      run: () => openPlaylists("library", true),
    })
  }

  const playSavedPlaylist = (playlist: SavedPlaylist) => {
    const nextTracks = playlist.tracks.map((item) => ({ ...item }))
    const first = nextTracks[0]
    if (!first) return

    const previousTracks = tracks.map((item) => ({ ...item }))
    const previousCurrentId = currentId
    const previousPlaying = playing

    setTracks(nextTracks)
    setQuery("")
    setCurrentId(first.id)
    intendedPlayRef.current = true
    setPlaying(true)
    if (first.id === currentId) playerRef.current?.loadVideoById?.(first.id)
    closePlaylists()
    notify(`Playing “${playlist.name}”`, {
      label: "Undo",
      run: () => {
        setTracks(previousTracks)
        setCurrentId(previousCurrentId)
        intendedPlayRef.current = previousPlaying
        setPlaying(previousPlaying)
        const player = playerRef.current
        if (!previousCurrentId) player?.stopVideo?.()
        else if (previousCurrentId === first.id) {
          // The track-id effect will not fire when both queues start with the
          // same song, so restore the underlying player state explicitly.
          if (previousPlaying) player?.playVideo?.()
          else player?.pauseVideo?.()
        }
      },
    })
  }

  const appendSavedPlaylist = (playlist: SavedPlaylist) => {
    const queuedIds = new Set(tracks.map((item) => item.id))
    const additions = playlist.tracks
      .filter((item) => !queuedIds.has(item.id))
      .map((item) => ({ ...item }))
    if (!additions.length) {
      notify("All songs are already in your queue")
      return
    }
    setTracks((prev) => [...prev, ...additions])
    if (!tracks.length) {
      intendedPlayRef.current = false
      setCurrentId(additions[0].id)
      setPlaying(false)
    }
    notify(
      `Added ${additions.length} ${
        additions.length === 1 ? "song" : "songs"
      } from “${playlist.name}”`,
    )
  }

  const deleteSavedPlaylist = (playlist: SavedPlaylist) => {
    const index = savedPlaylists.findIndex((item) => item.id === playlist.id)
    setSavedPlaylists((prev) => prev.filter((item) => item.id !== playlist.id))
    notify(`Deleted “${playlist.name}”`, {
      label: "Undo",
      run: () =>
        setSavedPlaylists((prev) => {
          if (prev.some((item) => item.id === playlist.id)) return prev
          const next = [...prev]
          next.splice(Math.max(0, index), 0, playlist)
          return next
        }),
    })
  }

  const searchYouTube = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearchError("")
    setSearchLoading(true)
    setSearchResults([])
    try {
      const response = await fetch(`${SEARCH_PROXY}?q=${encodeURIComponent(q)}`)
      const json = await response.json()
      if (!response.ok) {
        const errorValue = json.error
        const message =
          typeof errorValue === "string"
            ? errorValue
            : errorValue?.message ||
              json?.error?.errors?.[0]?.message ||
              `Unable to search YouTube (${response.status})`
        const blocked = /blocked|referer|permission|restricted|forbidden/i.test(
          message,
        )
        throw new Error(
          blocked
            ? "YouTube blocked the search request. Check the API key restrictions, or set a valid YOUTUBE_API_KEY for the proxy."
            : message,
        )
      }
      const items = Array.isArray(json.items) ? json.items : []
      const results: Track[] = items
        .map(
          (item: {
            id?: { videoId?: string }
            snippet?: { title?: string; channelTitle?: string }
          }) => ({
            id: item.id?.videoId,
            title: decodeEntities(item.snippet?.title ?? "Untitled"),
            artist: decodeEntities(
              item.snippet?.channelTitle ?? "Unknown channel",
            ),
          }),
        )
        .filter((item: { id?: string }): item is Track => Boolean(item.id))
      setSearchResults(results)
      if (results.length === 0)
        setSearchError("No videos found for that search.")
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "Search failed. Make sure the proxy is running and the request is allowed.",
      )
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery])

  /* ---- drag-to-reorder ---- */
  const dragIdRef = useRef<string | null>(null)
  useEffect(() => {
    dragIdRef.current = dragId
  }, [dragId])

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

  const startDrag = useCallback(
    (id: string) => {
      setDragId(id)
      const onMove = (e: PointerEvent) => {
        const el = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("[data-track-id]") as HTMLElement | null
        const overId = el?.dataset.trackId
        if (overId && overId !== dragIdRef.current) reorderTo(overId)
      }
      const onUp = () => {
        setDragId(null)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [reorderTo],
  )

  const cycleRepeat = () =>
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))
  const repeatLabel =
    repeat === "off"
      ? "Repeat off"
      : repeat === "all"
        ? "Repeat all"
        : "Repeat one"

  const nextTheme =
    THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
  const cycleTheme = () => {
    setTheme(nextTheme)
    notify(
      nextTheme === "system"
        ? "Theme: System — following your device"
        : `Theme: ${THEME_LABEL[nextTheme]}`,
    )
  }

  return (
    <div className="min-h-dvh w-full px-3 pt-5 pb-28 sm:px-6 sm:pt-8 lg:px-10 lg:pb-10">
      {/* Header -------------------------------------------------------- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="neu-sm grid h-14 w-14 shrink-0 place-items-center rounded-2xl p-1.5 sm:h-[68px] sm:w-[68px] sm:rounded-3xl sm:p-2">
            <img
              src={logoUrl}
              alt=""
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <p className="brand-text font-display truncate text-xl font-extrabold leading-none sm:text-3xl">
              Youtugtog
            </p>
            <p
              className="mt-1 truncate text-[0.68rem] font-medium sm:text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Tugtog Pinoy anytime
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openPlaylists("library")}
            className="neu-btn hidden cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold sm:flex"
          >
            <Icon.Library size={17} />
            My playlists
          </button>
          <span className="sm:hidden">
            <IconButton
              label="My playlists"
              onClick={() => openPlaylists("library")}
              size={44}
            >
              <Icon.Library size={18} />
            </IconButton>
          </span>
          <button
            type="button"
            onClick={openSearch}
            className="accent-btn hidden cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold sm:flex"
          >
            <Icon.Search size={16} />
            Search YouTube
          </button>
          <span className="sm:hidden">
            <IconButton label="Search YouTube" onClick={openSearch} size={46}>
              <Icon.Search size={19} />
            </IconButton>
          </span>
          <IconButton
            label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[nextTheme]}.`}
            title={`Theme: ${THEME_LABEL[theme]}`}
            onClick={cycleTheme}
            size={46}
          >
            <span style={{ color: "var(--accent-text)" }}>
              {theme === "system" ? (
                <Icon.System />
              ) : theme === "dark" ? (
                <Icon.Moon />
              ) : (
                <Icon.Sun />
              )}
            </span>
          </IconButton>
        </div>
      </header>

      <main className="mx-auto mt-6 grid max-w-6xl gap-5 sm:mt-8 sm:gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-8">
        {/* Now playing ------------------------------------------------ */}
        <section
          ref={playerCardRef}
          aria-label="Player"
          /* min-w-0: grid items default to min-width:auto, which lets long
             track titles push the card wider than the viewport. */
          className="neu min-w-0 rounded-[1.75rem] p-4 min-[360px]:p-5 sm:rounded-[2rem] sm:p-6 lg:sticky lg:top-6 lg:self-start"
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className="font-display text-[0.65rem] font-bold uppercase tracking-[0.3em]"
              style={{ color: "var(--text-muted)" }}
            >
              {buffering ? "Buffering" : playing ? "Playing now" : "Paused"}
            </p>
            <button
              type="button"
              onClick={() => setShowVideo((v) => !v)}
              aria-pressed={showVideo}
              className={`neu-btn flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[0.68rem] font-bold uppercase tracking-wider ${
                showVideo ? "is-pressed" : ""
              }`}
              style={{
                color: showVideo ? "var(--accent-text)" : "var(--text-muted)",
              }}
            >
              <Icon.Video size={15} off={!showVideo} />
              {showVideo ? "Video" : "Audio"}
            </button>
          </div>

          {/* Audio → circular disc. Video → rectangular 16:9 frame in the
              same spot. The player mount is always rendered (parked off
              screen in audio mode) so it is never re-created and audio keeps
              playing across the toggle. */}
          <div className="mt-5 sm:mt-6">
            {!showVideo && (
              <CircularCover
                trackId={track?.id}
                playing={playing}
                progress={progress}
                ready={ready}
              />
            )}
            <div className={`disc-video ${showVideo ? "" : "is-parked"}`}>
              <div ref={mountRef} />
              {showVideo && !ready && (
                <div className="disc-video__loading">loading player…</div>
              )}
            </div>
          </div>

          <div className="mt-6 text-center" aria-live="polite">
            <h1
              className="font-display line-clamp-2 text-lg font-extrabold text-balance break-words sm:text-xl"
              style={{ color: "var(--text-strong)" }}
              title={track?.title}
            >
              {track?.title ?? "—"}
            </h1>
            <p
              className="mt-1 truncate text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {track?.artist ?? ""}
            </p>
          </div>

          {/* Seek */}
          <div className="mt-5">
            <Slider
              value={displayTime}
              max={duration}
              onPreview={setScrubTime}
              onCommit={seekTo}
              label="Seek"
              valueText={`${fmt(displayTime)} of ${fmt(duration)}`}
              disabled={!duration}
              step={5}
              height={10}
            />
            <div
              className="mt-2.5 flex justify-between text-[0.7rem] font-semibold tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              <span>{fmt(displayTime)}</span>
              <span>{duration ? fmt(duration) : "--:--"}</span>
            </div>
          </div>

          {/* Transport */}
          <div
            ref={transportRef}
            className="mt-5 flex items-center justify-center gap-1.5 min-[360px]:gap-2.5 sm:gap-4"
          >
            <IconButton
              label={shuffle ? "Shuffle on" : "Shuffle off"}
              onClick={() => {
                setShuffle((s) => !s)
                notify(shuffle ? "Shuffle off" : "Shuffle on")
              }}
              sizeClass="h-10 w-10 min-[360px]:h-11 min-[360px]:w-11"
              pressed={shuffle}
            >
              <Icon.Shuffle size={17} />
            </IconButton>

            <IconButton
              label="Previous track"
              onClick={() => advance(-1)}
              sizeClass="h-[46px] w-[46px] min-[360px]:h-13 min-[360px]:w-13"
            >
              <Icon.Prev size={20} />
            </IconButton>

            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={toggle}
              className="accent-btn grid h-[58px] w-[58px] shrink-0 cursor-pointer place-items-center rounded-full min-[360px]:h-[68px] min-[360px]:w-[68px]"
            >
              {playing ? <Icon.Pause size={26} /> : <Icon.Play size={26} />}
            </button>

            <IconButton
              label="Next track"
              onClick={() => advance(1)}
              sizeClass="h-[46px] w-[46px] min-[360px]:h-13 min-[360px]:w-13"
            >
              <Icon.Next size={20} />
            </IconButton>

            <IconButton
              label={repeatLabel}
              onClick={cycleRepeat}
              sizeClass="h-10 w-10 min-[360px]:h-11 min-[360px]:w-11"
              pressed={repeat !== "off"}
            >
              {repeat === "one" ? (
                <Icon.RepeatOne size={17} />
              ) : (
                <Icon.Repeat size={17} />
              )}
            </IconButton>
          </div>

          <p
            className="mt-2.5 text-center text-[0.68rem] font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            {repeatLabel}
            {shuffle ? " · Shuffle" : ""}
          </p>

          {/* Volume */}
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full"
              style={{
                color: muted ? "var(--accent-text)" : "var(--text-muted)",
              }}
            >
              <Icon.Volume muted={muted || volume === 0} />
            </button>
            <div className="flex-1">
              <Slider
                value={muted ? 0 : volume}
                max={100}
                onPreview={(v) => {
                  setMuted(false)
                  setVolume(Math.round(v))
                }}
                onCommit={(v) => {
                  setMuted(false)
                  setVolume(Math.round(v))
                }}
                label="Volume"
                valueText={`${muted ? 0 : Math.round(volume)} percent`}
                height={9}
                step={5}
              />
            </div>
            <span
              className="w-9 shrink-0 text-right text-[0.7rem] font-semibold tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {muted ? 0 : Math.round(volume)}
            </span>
          </div>

          {wakeSupported && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  const next = !keepAwake
                  setKeepAwake(next)
                  notify(
                    next
                      ? "Screen will stay on while playing"
                      : "Screen can sleep again",
                  )
                }}
                aria-pressed={keepAwake}
                className={`neu-btn flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2.5 text-[0.68rem] font-bold ${
                  keepAwake ? "is-pressed" : ""
                }`}
                style={{
                  color: keepAwake ? "var(--accent-text)" : "var(--text-muted)",
                }}
              >
                <Icon.Awake size={15} />
                {keepAwake ? "Keeping screen on" : "Keep screen on"}
              </button>
            </div>
          )}
        </section>

        {/* Queue ------------------------------------------------------ */}
        <section
          aria-label="Queue"
          className="neu min-w-0 rounded-[1.75rem] p-5 sm:rounded-[2rem] sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2
                className="font-display text-base font-extrabold sm:text-lg"
                style={{ color: "var(--text-strong)" }}
              >
                Your queue
              </h2>
              <p
                className="mt-0.5 text-[0.7rem] font-semibold tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {tracks.length} {tracks.length === 1 ? "song" : "songs"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openPlaylists("save")}
              disabled={tracks.length === 0}
              className="neu-btn flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold"
            >
              <Icon.Save size={16} />
              Save queue
            </button>
          </div>

          {/* Add by link */}
          <div className="mt-4">
            <label htmlFor="add-link" className="sr-only">
              Paste a YouTube link
            </label>
            <div
              className={`neu-inset flex items-center gap-2.5 rounded-2xl px-3.5 py-2 ${
                addError ? "ring-2" : ""
              }`}
              style={
                addError
                  ? { boxShadow: "inset 0 0 0 2px var(--danger)" }
                  : undefined
              }
            >
              <span style={{ color: "var(--text-muted)" }}>
                <Icon.Link />
              </span>
              <input
                id="add-link"
                value={addValue}
                onChange={(e) => {
                  setAddValue(e.target.value)
                  setAddError("")
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTrack()
                }}
                placeholder="Paste a YouTube link…"
                inputMode="url"
                enterKeyHint="done"
                aria-invalid={Boolean(addError)}
                aria-describedby={addError ? "add-link-error" : undefined}
                className="w-full min-w-0 bg-transparent py-1.5 text-sm"
                style={{ color: "var(--text-strong)" }}
              />
              <button
                type="button"
                onClick={addTrack}
                className="accent-btn shrink-0 cursor-pointer rounded-xl px-4 py-2 text-sm font-bold"
              >
                Add
              </button>
            </div>
            {addError && (
              <p
                id="add-link-error"
                className="mt-2 px-1 text-xs font-medium"
                style={{ color: "var(--danger)" }}
              >
                {addError}
              </p>
            )}
          </div>

          {/* Filter */}
          <div className="neu-inset mt-3 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
            <span style={{ color: "var(--text-muted)" }}>
              <Icon.Search />
            </span>
            <label htmlFor="filter-queue" className="sr-only">
              Filter your queue
            </label>
            <input
              id="filter-queue"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter your queue…"
              className="w-full min-w-0 bg-transparent text-sm"
              style={{ color: "var(--text-strong)" }}
            />
          </div>

          <p
            className="mt-3 px-1 text-[0.68rem] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Drag the handle to reorder · swipe a row left to remove · press
            Space to play or pause
          </p>

          {/* On phones the list flows with the page — a scroll box inside a
              scrolling page traps the gesture. It only becomes its own
              scroller at lg, where the player is pinned alongside it. */}
          <ul className="soft-scroll -mx-1 mt-2 space-y-2.5 px-1 pb-1 lg:max-h-[min(66dvh,640px)] lg:overflow-y-auto">
            {filtered.length === 0 && (
              <li
                className="neu-inset rounded-2xl px-5 py-10 text-center text-sm font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {tracks.length === 0
                  ? "Your queue is empty — search YouTube or paste a link to add a song."
                  : `No songs match “${query}”.`}
              </li>
            )}
            {filtered.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                isCurrent={t.id === currentId}
                playing={playing}
                isDragging={dragId === t.id}
                onPlay={() => playTrack(t.id)}
                onDelete={() => deleteTrack(t.id)}
                onDragStart={() => startDrag(t.id)}
                onMoveBy={(delta) => moveTrack(t.id, delta)}
              />
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto mt-6 max-w-6xl px-2 text-center">
        <p
          className="text-[0.7rem] leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          Youtugtog plays through YouTube’s official embedded player, so views
          and ads count normally. Switch to{" "}
          <strong style={{ color: "var(--text)" }}>Video</strong> any time to
          bring the picture back.
        </p>
      </footer>

      {showMini && (
        <MiniPlayer
          track={track}
          playing={playing}
          progress={progress}
          onToggle={toggle}
          onNext={() => advance(1)}
          onPrev={() => advance(-1)}
          onExpand={() =>
            playerCardRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
        />
      )}

      <SearchModal
        open={searchOpen}
        onClose={closeSearch}
        query={searchQuery}
        setQuery={(v) => {
          setSearchQuery(v)
          setSearchError("")
        }}
        onSearch={searchYouTube}
        loading={searchLoading}
        error={searchError}
        results={searchResults}
        isQueued={(id) => tracks.some((t) => t.id === id)}
        onAdd={addSearchResult}
        onPlay={playSearchResult}
        inputRef={searchInputRef}
      />

      <SavedPlaylistsModal
        open={playlistsOpen}
        view={playlistsView}
        onViewChange={setPlaylistsView}
        onClose={closePlaylists}
        playlists={savedPlaylists}
        currentTracks={tracks}
        defaultName={playlistDefaultName}
        onSave={saveCurrentQueue}
        onPlay={playSavedPlaylist}
        onAppend={appendSavedPlaylist}
        onDelete={deleteSavedPlaylist}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
