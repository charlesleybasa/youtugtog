import usePlaylistSuggestions from "./usePlaylistSuggestions"
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
import SavedPlaylistsModal, {
  type SavedPlaylist,
} from "./components/SavedPlaylistsModal"
import SessionModal from "./components/SessionModal"
import LegalPage, { isLegalPath } from "./components/LegalPage"
import { pickNextShuffledId } from "./shuffle"
import {
  apiCreateSession,
  apiEndSession,
  apiJoinSession,
  apiLeaveSession,
  apiPollSession,
  apiSendCommand,
  apiSyncSession,
  buildSessionShareUrl,
  createCommandId,
  describeRemoteCommand,
  formatSessionCode,
  getOrCreateClientId,
  loadActiveSession,
  openSessionBroadcast,
  openSessionEventStream,
  parseSessionCodeInput,
  removeLocalSessionBackup,
  saveActiveSession,
  saveLocalSessionBackup,
  type SessionCommand,
  type SessionCommandPayload,
  type SessionRole,
  type SessionSnapshot,
} from "./sessionSync"

/* --------------------------------------------------------------------- *
 * Tugtog — build and play a YouTube music queue.
 *
 * Playback runs through the official YouTube IFrame Player API. The player
 * remains visible while playback is active and pauses whenever the page is
 * hidden or another surface covers it.
 * --------------------------------------------------------------------- */

type Track = { id: string; title: string; artist: string }
type Repeat = "off" | "all" | "one"
type Theme = "system" | "light" | "dark"
type ToastState = {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

const STARTER: Track[] = []

const SEARCH_PROXY = "/api/search"
const VIDEO_PROXY = "/api/videos"
const STORE_KEY = "tugtog:state:v3"
const LEGACY_STORE_KEYS = ["youtugtog:state:v2", "youtugtog:state:v1"]

/* ---- Small helpers -------------------------------------------------- */

function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s

  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  const pathParts = url.pathname.split("/").filter(Boolean)
  let candidate: string | null = null

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = pathParts[0] ?? null
  } else if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    candidate = url.searchParams.get("v")
    if (
      !candidate &&
      pathParts.length > 1 &&
      ["embed", "shorts", "live"].includes(pathParts[0])
    ) {
      candidate = pathParts[1]
    }
  }

  return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)
    ? candidate
    : null
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

type VideoSummary = {
  id: string
  title: string
  channelTitle: string
  thumbnailURL: string
  durationSeconds: number
  embeddable: boolean
  madeForKids: boolean
  refreshedAt: string
}

/** Resolve and validate pasted IDs through the same API used by the iOS app. */
async function fetchVideoMeta(
  id: string,
): Promise<{ title: string; artist: string } | null> {
  try {
    const res = await fetch(`${VIDEO_PROXY}?ids=${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { items?: VideoSummary[] }
    const video = data.items?.[0]
    if (!video) return null
    return {
      title: video.title,
      artist: video.channelTitle,
    }
  } catch {
    return null
  }
}

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
      localStorage.getItem(STORE_KEY) ??
      LEGACY_STORE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
}

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
  Broadcast: (p: { size?: number }) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.3" fill="currentColor" />
      <path
        d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  ),
  Copy: (p: { size?: number }) => (
    <svg
      width={p.size ?? 16}
      height={p.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.9"
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
  playlists,
  /** Owned by App so the opener can focus it inside the click gesture. */
}: {
  playlists: SavedPlaylist[]
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
  const suggestions = usePlaylistSuggestions(open && !query.trim(), playlists, SEARCH_PROXY)
  const showingSuggestions = !query.trim()
  const visibleResults = showingSuggestions ? suggestions.songs : results
  const visibleLoading = showingSuggestions ? suggestions.loading : loading
  const visibleError = showingSuggestions ? suggestions.error : error
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
              Find embeddable music videos and add them to your queue.
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
              if (e.key === "Enter") {
                e.preventDefault()
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                onSearch()
              }
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

        {showingSuggestions && (
          <div className="mt-4" style={{ color: "var(--text-muted)" }}>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>Suggested for you</h2>
            <p className="mt-1 text-xs">Based on artists in your saved playlists.</p>
          </div>
        )}

        {visibleError && (
          <p
            className="neu-inset mt-3 rounded-xl px-4 py-3 text-xs leading-relaxed"
            role="status"
            aria-live="polite"
            style={{ color: "var(--danger)" }}
          >
            {visibleError}
          </p>
        )}

        <div className="soft-scroll -mx-1 mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-1">
          {visibleLoading &&
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

          {!visibleLoading && visibleResults.length === 0 && !visibleError && (
            <div
              className="neu-inset rounded-2xl px-5 py-8 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {showingSuggestions
                ? suggestions.hasPlaylists
                  ? "No new suggestions yet. Try searching for a song."
                  : "Save a playlist to discover more songs from your favorite artists."
                : "Search for a song, then add it to your queue."}
            </div>
          )}

          {!visibleLoading &&
            visibleResults.map((result, i) => {
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
  const path = window.location.pathname
  return isLegalPath(path) ? <LegalPage path={path} /> : <TugtogPlayerApp />
}

function TugtogPlayerApp() {
  const [saved] = useState<Persisted>(loadPersisted)

  const [theme, setTheme] = useState<Theme>(() => initialTheme(saved))
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)
  // "system" tracks the OS live, so a device switching to night mode is
  // reflected without a reload; an explicit light/dark choice always wins.
  const dark = theme === "system" ? systemDark : theme === "dark"
  // Array.isArray, not `.length`: an empty saved queue is a deliberate user
  // state ("I deleted everything"), not a missing one. Using truthiness here
  // resurrected the starter list on the next visit.
  const [tracks, setTracks] = useState<Track[]>(() =>
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
      : ((Array.isArray(saved.tracks) ? saved.tracks[0]?.id : STARTER[0]?.id) ??
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
  const [toast, setToast] = useState<ToastState | null>(null)

  /* ---- remote session state ---- */
  const [clientId] = useState(getOrCreateClientId)
  const [sessionRole, setSessionRole] = useState<SessionRole>(null)
  const [sessionCode, setSessionCode] = useState<string | null>(null)
  const [sessionConnectedClients, setSessionConnectedClients] = useState(0)
  const [lastRemoteAction, setLastRemoteAction] = useState<string | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [sessionError, setSessionError] = useState("")

  const playerRef = useRef<any>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const tick = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // What the *user* asked for. `playing` mirrors the YouTube player, which a
  // backgrounding browser can flip to paused on its own; this does not move.
  const intendedPlayRef = useRef(false)
  const wakeLockRef = useRef<any>(null)
  const searchTriggerRef = useRef<HTMLElement | null>(null)
  const playlistsTriggerRef = useRef<HTMLElement | null>(null)
  const sessionTriggerRef = useRef<HTMLElement | null>(null)
  const toastSeq = useRef(0)
  // Tracks selected during the current shuffle cycle. Keeping this separate
  // from React state lets consecutive player events update it synchronously.
  const shufflePlayedRef = useRef<Set<string>>(new Set())

  const sessionRoleRef = useRef<SessionRole>(null)
  sessionRoleRef.current = sessionRole
  const sessionCodeRef = useRef<string | null>(null)
  sessionCodeRef.current = sessionCode
  const sessionRevRef = useRef(1)
  const processedCommandIdsRef = useRef<Set<string>>(new Set())
  const ackedCommandListRef = useRef<string[]>([])
  const unackedControllerCommandsRef = useRef<Map<string, number>>(new Map())
  const broadcastRef = useRef<ReturnType<typeof openSessionBroadcast> | null>(
    null,
  )
  const broadcastClientsRef = useRef<Map<string, number>>(new Map())
  const volumeCmdThrottleRef = useRef<number>(0)

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

  const sendRemoteCommand = useCallback(
    (payload: SessionCommandPayload) => {
      const role = sessionRoleRef.current
      const code = sessionCodeRef.current
      if (role !== "controller" || !code) return
      const cmd: SessionCommand = {
        id: createCommandId(),
        clientId,
        createdAt: Date.now(),
        payload,
      }
      unackedControllerCommandsRef.current.set(cmd.id, Date.now())
      broadcastRef.current?.post({
        type: "command",
        code,
        command: cmd,
      })
      void apiSendCommand(code, clientId, cmd)
    },
    [clientId],
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
    if (sessionRole === "controller") return
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
    sessionRole,
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

  const advanceLocal = useCallback((delta: number) => {
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
    if (nextId === cid && sessionRoleRef.current !== "controller") {
      playerRef.current?.seekTo?.(0, true)
      playerRef.current?.playVideo?.()
    }
  }, [])

  const advance = useCallback(
    (delta: number) => {
      advanceLocal(delta)
      if (sessionRoleRef.current === "controller") {
        sendRemoteCommand({ type: "advance", delta })
      }
    },
    [advanceLocal, sendRemoteCommand],
  )

  const handleEnded = useCallback(() => {
    if (sessionRoleRef.current === "controller") return
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
    advanceLocal(1)
  }, [advanceLocal])

  /* ---- build the player once ---- */
  useEffect(() => {
    let killed = false
    loadYouTubeApi().then((YT) => {
      if (killed || !mountRef.current) return
      playerRef.current = new YT.Player(mountRef.current, {
        videoId: currentId ?? undefined,
        playerVars: {
          controls: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
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
        if (sessionRoleRef.current === "controller") {
          setTime((prev) =>
            duration > 0 ? Math.min(duration, prev + 0.25) : prev + 0.25,
          )
          return
        }
        const p = playerRef.current
        if (!p?.getCurrentTime) return
        setTime(p.getCurrentTime() || 0)
        setDuration(p.getDuration() || 0)
      }, 250)
    }
    return () => {
      if (tick.current) window.clearInterval(tick.current)
    }
  }, [playing, duration])

  /* ---- load new video when the current track changes ---- */
  const didInit = useRef(false)
  useEffect(() => {
    if (sessionRole === "controller") return
    const p = playerRef.current
    if (!ready || !p || !track) return
    if (!didInit.current) {
      // First ready: cue paused unless the user or remote controller explicitly started play.
      didInit.current = true
      if (intendedPlayRef.current) p.loadVideoById(track.id)
      else p.cueVideoById(track.id)
      return
    }
    if (intendedPlayRef.current) p.loadVideoById(track.id)
    else p.cueVideoById(track.id)
    setTime(0)
    setScrubTime(null)
    setDuration(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, ready, sessionRole])

  useEffect(() => {
    if (sessionRole === "controller") return
    const p = playerRef.current
    if (!p?.setVolume) return
    p.setVolume(muted ? 0 : volume)
  }, [volume, muted, sessionRole])

  const toggle = useCallback(() => {
    if (sessionRoleRef.current === "controller") {
      const nextPlaying = !playing
      if (nextPlaying && !currentId && tracks.length > 0) {
        setCurrentId(tracks[0].id)
      }
      setPlaying(nextPlaying)
      sendRemoteCommand({ type: "setPlaying", playing: nextPlaying })
      return
    }
    const p = playerRef.current
    if (!playing && !currentId && tracks.length > 0) {
      setCurrentId(tracks[0].id)
      intendedPlayRef.current = true
      setPlaying(true)
      return
    }
    if (!p) return
    if (playing) {
      intendedPlayRef.current = false
      setPlaying(false)
      p.pauseVideo?.()
    } else {
      intendedPlayRef.current = true
      setPlaying(true)
      p.playVideo?.()
    }
  }, [playing, currentId, tracks, sendRemoteCommand])

  const seekTo = useCallback(
    (seconds: number) => {
      if (sessionRoleRef.current === "controller") {
        setTime(seconds)
        setScrubTime(null)
        sendRemoteCommand({ type: "seekTo", seconds })
        return
      }
      const p = playerRef.current
      if (!p?.seekTo) return
      p.seekTo(seconds, true)
      setTime(seconds)
      setScrubTime(null)
    },
    [sendRemoteCommand],
  )

  /* Keep the screen awake only while the official player is visible. */
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
    const pauseForHiddenSurface = () => {
      if (sessionRoleRef.current === "host") return
      intendedPlayRef.current = false
      playerRef.current?.pauseVideo?.()
      setPlaying(false)
      releaseWakeLock()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") pauseForHiddenSurface()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pagehide", pauseForHiddenSurface)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pagehide", pauseForHiddenSurface)
    }
  }, [releaseWakeLock])

  // Search and playlist sheets cover the player. Pause first and require an
  // explicit new play action after the sheet has closed.
  useEffect(() => {
    if (sessionRole === "controller") return
    if (!searchOpen && !playlistsOpen) return
    intendedPlayRef.current = false
    playerRef.current?.pauseVideo?.()
    setPlaying(false)
    releaseWakeLock()
  }, [searchOpen, playlistsOpen, sessionRole, releaseWakeLock])

  /* ---- search modal open/close ----------------------------------- *
   * iOS only raises the soft keyboard when .focus() runs inside the user
   * gesture. flushSync commits the modal to the DOM synchronously so the
   * input exists and can be focused before the tap handler returns. */
  const openSearch = useCallback(() => {
    searchTriggerRef.current = document.activeElement as HTMLElement | null
    setPlaylistsOpen(false)
    setSessionOpen(false)
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
        playlistsTriggerRef.current =
          document.activeElement as HTMLElement | null
      }
      setSearchOpen(false)
      setSessionOpen(false)
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

  const openSessionModal = useCallback(() => {
    sessionTriggerRef.current = document.activeElement as HTMLElement | null
    setSearchOpen(false)
    setPlaylistsOpen(false)
    setSessionError("")
    setSessionOpen(true)
  }, [])

  const closeSessionModal = useCallback(() => {
    setSessionOpen(false)
    setSessionError("")
    const trigger = sessionTriggerRef.current
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
      if (searchOpen || playlistsOpen || sessionOpen) return
      if (e.key === " " || e.key === "k") {
        e.preventDefault()
        toggle()
      } else if (e.key === "ArrowRight" && e.shiftKey) advance(1)
      else if (e.key === "ArrowLeft" && e.shiftKey) advance(-1)
      else if (e.key === "m") {
        setMuted((m) => {
          const next = !m
          if (sessionRoleRef.current === "controller") {
            sendRemoteCommand({ type: "setMuted", muted: next })
          }
          return next
        })
      } else if (e.key === "/") {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    toggle,
    advance,
    searchOpen,
    playlistsOpen,
    sessionOpen,
    openSearch,
    sendRemoteCommand,
  ])

  /* ---- queue operations ---- */

  const playTrack = (id: string) => {
    if (id === currentId) {
      toggle()
      return
    }
    setCurrentId(id)
    intendedPlayRef.current = true
    setPlaying(true)
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "playTrack", id })
      return
    }
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
        if (sessionRoleRef.current !== "controller") {
          playerRef.current?.stopVideo?.()
        }
        setCurrentId(null)
        setPlaying(false)
        setTime(0)
        setScrubTime(null)
        setDuration(0)
      }
      return next
    })
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "deleteTrack", id })
    }
    notify(`Removed “${removed.title}”`, {
      label: "Undo",
      run: () => {
        setTracks((prev) => {
          if (prev.some((t) => t.id === removed.id)) return prev
          const next = [...prev]
          next.splice(Math.min(index, next.length), 0, removed)
          if (wasCurrent) setCurrentId(removed.id)
          return next
        })
        if (sessionRoleRef.current === "controller") {
          sendRemoteCommand({
            type: "restoreTrack",
            track: removed,
            index,
            wasCurrent,
          })
        }
      },
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
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "moveTrack", id, delta })
    }
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
      { id, title: PENDING_TITLE, artist: "Fetching details…" },
      ...prev,
    ])
    if (!tracks.length) setCurrentId(id)
    notify("Added to the top of your queue")
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "addTrackById", id })
    }
    void resolveTrackMeta(id)
  }

  const addSearchResult = (result: Track) => {
    if (tracks.some((t) => t.id === result.id)) return
    setTracks((prev) => [result, ...prev])
    if (!tracks.length) setCurrentId(result.id)
    notify(`Queued “${result.title}”`)
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "addSearchResult", track: result })
    }
  }

  const playSearchResult = (result: Track) => {
    if (!tracks.some((t) => t.id === result.id))
      setTracks((prev) => [result, ...prev])
    setCurrentId(result.id)
    intendedPlayRef.current = true
    setPlaying(true)
    setSearchOpen(false)
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "playSearchResult", track: result })
    } else if (result.id === currentId) {
      playerRef.current?.playVideo?.()
    }
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
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "saveCurrentQueue", name: trimmedName })
    }
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
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "playPlaylist", playlist })
    } else if (first.id === currentId) {
      playerRef.current?.loadVideoById?.(first.id)
    }
    closePlaylists()
    notify(`Playing “${playlist.name}”`, {
      label: "Undo",
      run: () => {
        setTracks(previousTracks)
        setCurrentId(previousCurrentId)
        intendedPlayRef.current = previousPlaying
        setPlaying(previousPlaying)
        if (sessionRoleRef.current === "controller") {
          sendRemoteCommand({
            type: "restoreQueue",
            tracks: previousTracks,
            currentId: previousCurrentId,
            playing: previousPlaying,
          })
          return
        }
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
    setTracks((prev) => [...additions, ...prev])
    if (!tracks.length) {
      intendedPlayRef.current = false
      setCurrentId(additions[0].id)
      setPlaying(false)
    }
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "appendPlaylist", playlist })
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
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "deletePlaylist", id: playlist.id })
    }
    notify(`Deleted “${playlist.name}”`, {
      label: "Undo",
      run: () => {
        setSavedPlaylists((prev) => {
          if (prev.some((item) => item.id === playlist.id)) return prev
          const next = [...prev]
          next.splice(Math.max(0, index), 0, playlist)
          return next
        })
        if (sessionRoleRef.current === "controller") {
          sendRemoteCommand({
            type: "restorePlaylist",
            playlist,
            index: Math.max(0, index),
          })
        }
      },
    })
  }

  const createSavedPlaylist = (name: string, songs: Track[]) => {
    const trimmedName = name.trim()
    if (!trimmedName || !songs.length) return
    const clonedSongs = songs.map((song) => ({ ...song }))
    const playlist: SavedPlaylist = {
      id:
        globalThis.crypto?.randomUUID?.() ??
        `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      tracks: clonedSongs,
      savedAt: new Date().toISOString(),
    }
    setSavedPlaylists((items) => [playlist, ...items])
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({
        type: "createPlaylist",
        name: trimmedName,
        tracks: clonedSongs,
      })
    }
    notify(`Created “${trimmedName}”`)
  }

  const updateSavedPlaylist = (playlist: SavedPlaylist) => {
    setSavedPlaylists((prev) =>
      prev.map((item) => (item.id === playlist.id ? playlist : item)),
    )
    if (sessionRoleRef.current === "controller") {
      sendRemoteCommand({ type: "updatePlaylist", playlist })
    }
    notify(`Updated “${playlist.name}”`)
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
      const items: VideoSummary[] = Array.isArray(json.items) ? json.items : []
      const results: Track[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.channelTitle,
      }))
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

  const reorderTo = useCallback(
    (targetId: string) => {
      const fromId = dragIdRef.current
      if (!fromId || fromId === targetId) return
      setTracks((prev) => {
        const from = prev.findIndex((t) => t.id === fromId)
        const to = prev.findIndex((t) => t.id === targetId)
        if (from < 0 || to < 0 || from === to) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
      if (sessionRoleRef.current === "controller") {
        sendRemoteCommand({ type: "reorderTo", dragId: fromId, targetId })
      }
    },
    [sendRemoteCommand],
  )

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

  const cycleRepeat = () => {
    setRepeat((r) => {
      const next: Repeat = r === "off" ? "all" : r === "all" ? "one" : "off"
      if (sessionRoleRef.current === "controller") {
        sendRemoteCommand({ type: "setRepeat", repeat: next })
      }
      return next
    })
  }
  const repeatLabel =
    repeat === "off"
      ? "Repeat off"
      : repeat === "all"
        ? "Repeat all"
        : "Repeat one"

  /* ---- remote session orchestration ---- */

  const buildSnapshot = useCallback((): SessionSnapshot => {
    sessionRevRef.current += 1
    return {
      tracks,
      currentId,
      playing,
      buffering,
      time,
      duration,
      volume,
      muted,
      repeat,
      shuffle,
      playlists: savedPlaylists,
      updatedAt: Date.now(),
      rev: sessionRevRef.current,
    }
  }, [
    tracks,
    currentId,
    playing,
    buffering,
    time,
    duration,
    volume,
    muted,
    repeat,
    shuffle,
    savedPlaylists,
  ])
  const buildSnapshotRef = useRef(buildSnapshot)
  buildSnapshotRef.current = buildSnapshot

  const applyHostSnapshot = useCallback(
    (snapshot: SessionSnapshot, ackCommandIds?: string[]) => {
      const now = Date.now()
      if (ackCommandIds?.length) {
        for (const id of ackCommandIds) {
          unackedControllerCommandsRef.current.delete(id)
        }
      }
      for (const [id, sentAt] of unackedControllerCommandsRef.current.entries()) {
        if (now - sentAt > 2500) {
          unackedControllerCommandsRef.current.delete(id)
        }
      }
      if (unackedControllerCommandsRef.current.size > 0) {
        return
      }
      setTracks(snapshot.tracks)
      setCurrentId(snapshot.currentId)
      setPlaying(snapshot.playing)
      setBuffering(snapshot.buffering)
      setTime(snapshot.time)
      setDuration(snapshot.duration)
      setVolume(snapshot.volume)
      setMuted(snapshot.muted)
      setRepeat(snapshot.repeat)
      setShuffle(snapshot.shuffle)
      setSavedPlaylists(snapshot.playlists)
    },
    [],
  )

  const executeRemoteCommand = useCallback(
    (cmd: SessionCommand) => {
      if (processedCommandIdsRef.current.has(cmd.id)) return
      processedCommandIdsRef.current.add(cmd.id)
      ackedCommandListRef.current = [
        ...ackedCommandListRef.current.slice(-79),
        cmd.id,
      ]

      const desc = describeRemoteCommand(cmd.payload)
      setLastRemoteAction(desc.label)
      if (desc.toast) notify(desc.toast)

      const payload = cmd.payload
      switch (payload.type) {
        case "togglePlay": {
          const p = playerRef.current
          if (playing) {
            intendedPlayRef.current = false
            setPlaying(false)
            p?.pauseVideo?.()
          } else {
            if (!stateRef.current.currentId && stateRef.current.tracks.length) {
              setCurrentId(stateRef.current.tracks[0].id)
            }
            setSearchOpen(false)
            setPlaylistsOpen(false)
            setSessionOpen(false)
            intendedPlayRef.current = true
            setPlaying(true)
            p?.playVideo?.()
          }
          break
        }
        case "setPlaying": {
          const p = playerRef.current
          if (payload.playing) {
            if (!stateRef.current.currentId && stateRef.current.tracks.length) {
              setCurrentId(stateRef.current.tracks[0].id)
            }
            setSearchOpen(false)
            setPlaylistsOpen(false)
            setSessionOpen(false)
            intendedPlayRef.current = true
            setPlaying(true)
            p?.playVideo?.()
          } else {
            intendedPlayRef.current = false
            setPlaying(false)
            p?.pauseVideo?.()
          }
          break
        }
        case "playTrack": {
          setSearchOpen(false)
          setPlaylistsOpen(false)
          setSessionOpen(false)
          const wasSame = payload.id === stateRef.current.currentId
          setCurrentId(payload.id)
          intendedPlayRef.current = true
          setPlaying(true)
          if (wasSame) playerRef.current?.playVideo?.()
          break
        }
        case "advance": {
          setSearchOpen(false)
          setPlaylistsOpen(false)
          setSessionOpen(false)
          advanceLocal(payload.delta)
          break
        }
        case "seekTo": {
          const p = playerRef.current
          p?.seekTo?.(payload.seconds, true)
          setTime(payload.seconds)
          setScrubTime(null)
          break
        }
        case "setVolume": {
          if (typeof payload.muted === "boolean") setMuted(payload.muted)
          else setMuted(false)
          setVolume(clamp(Math.round(payload.volume), 0, 100))
          break
        }
        case "setMuted": {
          setMuted(payload.muted)
          break
        }
        case "setShuffle": {
          setShuffle(payload.shuffle)
          break
        }
        case "setRepeat": {
          setRepeat(payload.repeat)
          break
        }
        case "addTrackById": {
          setTracks((prev) => {
            if (prev.some((t) => t.id === payload.id)) return prev
            if (!prev.length) setCurrentId(payload.id)
            return [
              {
                id: payload.id,
                title: PENDING_TITLE,
                artist: "Fetching details…",
              },
              ...prev,
            ]
          })
          void resolveTrackMeta(payload.id)
          break
        }
        case "addSearchResult": {
          setTracks((prev) => {
            if (prev.some((t) => t.id === payload.track.id)) return prev
            if (!prev.length) setCurrentId(payload.track.id)
            return [payload.track, ...prev]
          })
          break
        }
        case "playSearchResult": {
          setSearchOpen(false)
          setPlaylistsOpen(false)
          setSessionOpen(false)
          const wasSame = payload.track.id === stateRef.current.currentId
          setTracks((prev) =>
            prev.some((t) => t.id === payload.track.id)
              ? prev
              : [payload.track, ...prev],
          )
          setCurrentId(payload.track.id)
          intendedPlayRef.current = true
          setPlaying(true)
          if (wasSame) playerRef.current?.playVideo?.()
          break
        }
        case "deleteTrack": {
          setTracks((prev) => {
            const index = prev.findIndex((t) => t.id === payload.id)
            if (index < 0) return prev
            const next = prev.filter((t) => t.id !== payload.id)
            if (payload.id === stateRef.current.currentId && next.length) {
              setCurrentId(next[Math.min(index, next.length - 1)].id)
            } else if (payload.id === stateRef.current.currentId) {
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
          break
        }
        case "restoreTrack": {
          setTracks((prev) => {
            if (prev.some((t) => t.id === payload.track.id)) return prev
            const next = [...prev]
            next.splice(Math.min(payload.index, next.length), 0, payload.track)
            if (payload.wasCurrent) setCurrentId(payload.track.id)
            return next
          })
          break
        }
        case "moveTrack": {
          setTracks((prev) => {
            const from = prev.findIndex((t) => t.id === payload.id)
            const to = from + payload.delta
            if (from < 0 || to < 0 || to >= prev.length) return prev
            const next = [...prev]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
          })
          break
        }
        case "reorderTo": {
          setTracks((prev) => {
            const from = prev.findIndex((t) => t.id === payload.dragId)
            const to = prev.findIndex((t) => t.id === payload.targetId)
            if (from < 0 || to < 0 || from === to) return prev
            const next = [...prev]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
          })
          break
        }
        case "playPlaylist": {
          const nextTracks = payload.playlist.tracks.map((item) => ({
            ...item,
          }))
          const first = nextTracks[0]
          if (!first) break
          setSearchOpen(false)
          setPlaylistsOpen(false)
          setSessionOpen(false)
          const wasSame = first.id === stateRef.current.currentId
          setTracks(nextTracks)
          setQuery("")
          setCurrentId(first.id)
          intendedPlayRef.current = true
          setPlaying(true)
          if (wasSame) playerRef.current?.loadVideoById?.(first.id)
          break
        }
        case "restoreQueue": {
          const prevCurrent = stateRef.current.currentId
          setTracks(payload.tracks)
          setCurrentId(payload.currentId)
          intendedPlayRef.current = payload.playing
          setPlaying(payload.playing)
          const player = playerRef.current
          if (!payload.currentId) player?.stopVideo?.()
          else if (payload.currentId === prevCurrent) {
            if (payload.playing) player?.playVideo?.()
            else player?.pauseVideo?.()
          }
          break
        }
        case "appendPlaylist": {
          setTracks((prev) => {
            const queuedIds = new Set(prev.map((item) => item.id))
            const additions = payload.playlist.tracks
              .filter((item) => !queuedIds.has(item.id))
              .map((item) => ({ ...item }))
            if (!additions.length) return prev
            if (!prev.length) {
              intendedPlayRef.current = false
              setCurrentId(additions[0].id)
              setPlaying(false)
            }
            return [...additions, ...prev]
          })
          break
        }
        case "saveCurrentQueue": {
          const trimmedName = payload.name.trim()
          if (!trimmedName) break
          setSavedPlaylists((prev) => [
            {
              id:
                globalThis.crypto?.randomUUID?.() ??
                `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: trimmedName,
              tracks: stateRef.current.tracks.map((item) => ({ ...item })),
              savedAt: new Date().toISOString(),
            },
            ...prev,
          ])
          break
        }
        case "createPlaylist": {
          const trimmedName = payload.name.trim()
          if (!trimmedName || !payload.tracks.length) break
          setSavedPlaylists((prev) => [
            {
              id:
                globalThis.crypto?.randomUUID?.() ??
                `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: trimmedName,
              tracks: payload.tracks.map((item) => ({ ...item })),
              savedAt: new Date().toISOString(),
            },
            ...prev,
          ])
          break
        }
        case "updatePlaylist": {
          setSavedPlaylists((prev) =>
            prev.map((item) =>
              item.id === payload.playlist.id ? payload.playlist : item,
            ),
          )
          break
        }
        case "deletePlaylist": {
          setSavedPlaylists((prev) =>
            prev.filter((item) => item.id !== payload.id),
          )
          break
        }
        case "restorePlaylist": {
          setSavedPlaylists((prev) => {
            if (prev.some((item) => item.id === payload.playlist.id)) return prev
            const next = [...prev]
            next.splice(
              Math.max(0, payload.index),
              0,
              payload.playlist,
            )
            return next
          })
          break
        }
      }
    },
    [playing, advanceLocal, notify, resolveTrackMeta],
  )

  const executeRemoteCommandRef = useRef(executeRemoteCommand)
  executeRemoteCommandRef.current = executeRemoteCommand

  const startHostSession = useCallback(
    async (requestedCode?: string, silent = false) => {
      setSessionBusy(true)
      setSessionError("")
      try {
        const snap = buildSnapshot()
        const created = await apiCreateSession(clientId, snap, requestedCode)
        processedCommandIdsRef.current.clear()
        ackedCommandListRef.current = created.ackCommandIds ?? []
        broadcastClientsRef.current.clear()
        setSessionRole("host")
        setSessionCode(created.code)
        setSessionConnectedClients(created.connectedClients)
        setLastRemoteAction(null)
        saveActiveSession({ role: "host", code: created.code })
        saveLocalSessionBackup(created.code, snap, ackedCommandListRef.current)
        if (!silent) {
          notify(`Session ${formatSessionCode(created.code)} started`)
        }
      } finally {
        setSessionBusy(false)
      }
    },
    [buildSnapshot, clientId, notify],
  )

  const joinRemoteSession = useCallback(
    async (rawInput: string, silent = false) => {
      const parsedCode = parseSessionCodeInput(rawInput)
      if (!parsedCode) {
        setSessionError(
          "Enter a valid 6-character session code or paste a session link.",
        )
        return
      }
      if (sessionRoleRef.current === "host" && sessionCodeRef.current === parsedCode) {
        setSessionError("This device is already hosting that session.")
        return
      }
      setSessionBusy(true)
      setSessionError("")
      try {
        const joined = await apiJoinSession(parsedCode, clientId)
        if (!joined) {
          setSessionError(
            "Could not find an active session for that code. Make sure the host session is running.",
          )
          return
        }
        // Pause local player while controlling another device
        intendedPlayRef.current = false
        playerRef.current?.pauseVideo?.()
        unackedControllerCommandsRef.current.clear()
        setSessionRole("controller")
        setSessionCode(joined.code)
        setSessionConnectedClients(joined.connectedClients)
        applyHostSnapshot(joined.snapshot, joined.ackCommandIds)
        saveActiveSession({ role: "controller", code: joined.code })
        setSessionOpen(false)
        if (!silent) {
          notify(`Connected to session ${formatSessionCode(joined.code)}`)
        }
      } finally {
        setSessionBusy(false)
      }
    },
    [clientId, applyHostSnapshot, notify],
  )

  const endHostSession = useCallback(() => {
    const code = sessionCodeRef.current
    if (code) {
      broadcastRef.current?.post({ type: "ended", code })
      removeLocalSessionBackup(code)
      void apiEndSession(code, clientId)
    }
    setSessionRole(null)
    setSessionCode(null)
    setSessionConnectedClients(0)
    setLastRemoteAction(null)
    saveActiveSession(null)
    setSessionOpen(false)
    notify("Remote session ended")
  }, [clientId, notify])

  const leaveRemoteSession = useCallback(
    (reason?: string) => {
      const code = sessionCodeRef.current
      if (code) {
        broadcastRef.current?.post({ type: "leave", code, clientId })
        void apiLeaveSession(code, clientId)
      }
      unackedControllerCommandsRef.current.clear()
      setSessionRole(null)
      setSessionCode(null)
      setSessionConnectedClients(0)
      saveActiveSession(null)
      setSessionOpen(false)
      // Remove ?session= query param from URL if present so refreshing stays local
      if (window.location.search.includes("session=")) {
        const url = new URL(window.location.href)
        url.searchParams.delete("session")
        window.history.replaceState({}, "", url.toString())
      }
      notify(reason ?? "Disconnected from remote session")
    },
    [clientId, notify],
  )

  const copySessionCode = useCallback(async () => {
    if (!sessionCode) return
    const formatted = formatSessionCode(sessionCode)
    try {
      await navigator.clipboard.writeText(formatted)
      notify(`Copied code ${formatted}`)
    } catch {
      notify(`Session code: ${formatted}`)
    }
  }, [sessionCode, notify])

  const copySessionShareLink = useCallback(async () => {
    if (!sessionCode) return
    const shareUrl = buildSessionShareUrl(sessionCode)
    try {
      await navigator.clipboard.writeText(shareUrl)
      notify("Control link copied to clipboard")
    } catch {
      notify(`Share link: ${shareUrl}`)
    }
  }, [sessionCode, notify])

  const shareSessionLink = useCallback(async () => {
    if (!sessionCode || typeof navigator.share !== "function") return
    const formatted = formatSessionCode(sessionCode)
    const shareUrl = buildSessionShareUrl(sessionCode)
    try {
      await navigator.share({
        title: `Tugtog Session ${formatted}`,
        text: `Control my Tugtog music queue and playlists with code ${formatted}:`,
        url: shareUrl,
      })
    } catch {
      /* user dismissed native share sheet */
    }
  }, [sessionCode])

  /* ---- auto-join from ?session=CODE or resume from sessionStorage ---- */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlSession = params.get("session")
    const parsedFromUrl = urlSession ? parseSessionCodeInput(urlSession) : null
    if (parsedFromUrl) {
      void joinRemoteSession(parsedFromUrl)
      return
    }
    const persisted = loadActiveSession()
    if (!persisted) return
    if (persisted.role === "host") {
      void startHostSession(persisted.code, true)
    } else if (persisted.role === "controller") {
      void joinRemoteSession(persisted.code, true)
    }
    // Run once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- BroadcastChannel + Server-Sent Events + HTTP sync loop ---- */
  useEffect(() => {
    if (!sessionRole || !sessionCode) return

    const broadcast = openSessionBroadcast(
      (msg) => {
        if (msg.code !== sessionCode) return
        if (sessionRole === "host") {
          if (msg.type === "command") {
            broadcastClientsRef.current.set(msg.command.clientId, Date.now())
            setSessionConnectedClients((prev) =>
              Math.max(prev, broadcastClientsRef.current.size),
            )
            executeRemoteCommandRef.current(msg.command)
          } else if (msg.type === "join") {
            broadcastClientsRef.current.set(msg.clientId, Date.now())
            setSessionConnectedClients((prev) =>
              Math.max(prev, broadcastClientsRef.current.size),
            )
            const snap = buildSnapshotRef.current()
            const acks = ackedCommandListRef.current
            broadcast.post({
              type: "snapshot",
              code: sessionCode,
              snapshot: snap,
              ackCommandIds: acks,
            })
          } else if (msg.type === "leave") {
            broadcastClientsRef.current.delete(msg.clientId)
            setSessionConnectedClients(broadcastClientsRef.current.size)
          }
        } else if (sessionRole === "controller") {
          if (msg.type === "snapshot") {
            applyHostSnapshot(msg.snapshot, msg.ackCommandIds)
          } else if (msg.type === "ended") {
            leaveRemoteSession("Host ended the session")
          }
        }
      },
      {
        code: sessionCode,
        role: sessionRole,
        clientId,
        getLatestSnapshotEnvelope: () => ({
          type: "snapshot",
          code: sessionCode,
          snapshot: buildSnapshotRef.current(),
          ackCommandIds: ackedCommandListRef.current,
        }),
      },
    )
    broadcastRef.current = broadcast

    if (sessionRole === "controller") {
      broadcast.post({ type: "join", code: sessionCode, clientId })
    }

    const closeEventStream = openSessionEventStream(
      sessionCode,
      sessionRole,
      clientId,
      (event) => {
        if (sessionRole === "host") {
          if (event.type === "commands") {
            setSessionConnectedClients((prev) =>
              Math.max(
                prev,
                event.connectedClients,
                broadcastClientsRef.current.size,
              ),
            )
            for (const cmd of event.commands) {
              executeRemoteCommandRef.current(cmd)
            }
          } else if (event.type === "presence") {
            setSessionConnectedClients(
              Math.max(
                event.connectedClients,
                broadcastClientsRef.current.size,
              ),
            )
          }
        } else if (sessionRole === "controller") {
          if (event.type === "snapshot") {
            setSessionConnectedClients(event.connectedClients)
            applyHostSnapshot(event.snapshot, event.ackCommandIds)
          } else if (event.type === "presence") {
            setSessionConnectedClients(event.connectedClients)
          } else if (event.type === "ended") {
            leaveRemoteSession("Host ended the session")
          }
        }
      },
    )

    const pollInterval = window.setInterval(async () => {
      const polled = await apiPollSession(sessionCode, sessionRole, clientId)
      if (!polled) return
      if (sessionRole === "host") {
        setSessionConnectedClients(
          Math.max(polled.connectedClients, broadcastClientsRef.current.size),
        )
        if (polled.pendingCommands.length > 0) {
          for (const cmd of polled.pendingCommands) {
            executeRemoteCommandRef.current(cmd)
          }
        }
      } else if (sessionRole === "controller") {
        setSessionConnectedClients(polled.connectedClients)
        applyHostSnapshot(polled.snapshot, polled.ackCommandIds)
      }
    }, 1000)

    return () => {
      window.clearInterval(pollInterval)
      closeEventStream()
      broadcast.close()
      broadcastRef.current = null
    }
  }, [
    sessionRole,
    sessionCode,
    clientId,
    applyHostSnapshot,
    leaveRemoteSession,
  ])

  /* ---- Host: broadcast snapshot immediately on state change ---- */
  useEffect(() => {
    if (sessionRole !== "host" || !sessionCode) return
    const snap = buildSnapshot()
    const acks = ackedCommandListRef.current
    saveLocalSessionBackup(sessionCode, snap, acks)
    broadcastRef.current?.post({
      type: "snapshot",
      code: sessionCode,
      snapshot: snap,
      ackCommandIds: acks,
    })
    void apiSyncSession(sessionCode, clientId, snap, acks).then((res) => {
      if (!res) return
      setSessionConnectedClients(
        Math.max(res.connectedClients, broadcastClientsRef.current.size),
      )
      if (res.pendingCommands.length > 0) {
        for (const cmd of res.pendingCommands) {
          executeRemoteCommandRef.current(cmd)
        }
      }
    })
    // Intentionally exclude `time` so 250ms position ticks don't flood POSTs;
    // position is synced on structural state changes and on a 1.5s heartbeat below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionRole,
    sessionCode,
    clientId,
    tracks,
    currentId,
    playing,
    buffering,
    duration,
    volume,
    muted,
    repeat,
    shuffle,
    savedPlaylists,
  ])

  /* ---- Host: periodic position sync while playing ---- */
  const latestTimeRef = useRef({ time, duration })
  latestTimeRef.current = { time, duration }
  useEffect(() => {
    if (sessionRole !== "host" || !sessionCode || !playing) return
    const timer = window.setInterval(() => {
      const snap: SessionSnapshot = {
        tracks: stateRef.current.tracks,
        currentId: stateRef.current.currentId,
        playing: true,
        buffering,
        time: latestTimeRef.current.time,
        duration: latestTimeRef.current.duration,
        volume,
        muted,
        repeat: stateRef.current.repeat,
        shuffle: stateRef.current.shuffle,
        playlists: savedPlaylists,
        updatedAt: Date.now(),
        rev: sessionRevRef.current,
      }
      const acks = ackedCommandListRef.current
      saveLocalSessionBackup(sessionCode, snap, acks)
      broadcastRef.current?.post({
        type: "snapshot",
        code: sessionCode,
        snapshot: snap,
        ackCommandIds: acks,
      })
      void apiSyncSession(sessionCode, clientId, snap, acks)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [
    sessionRole,
    sessionCode,
    clientId,
    playing,
    buffering,
    volume,
    muted,
    savedPlaylists,
  ])

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
              src="/icon-192.png"
              alt=""
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <p className="brand-text font-display truncate text-xl font-extrabold leading-none sm:text-3xl">
              Tugtog
            </p>
            <p
              className="mt-1 truncate text-[0.68rem] font-medium sm:text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Build and play music queues
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openSessionModal}
            aria-pressed={sessionRole !== null}
            className={`neu-btn hidden cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold sm:flex ${
              sessionRole !== null ? "is-pressed" : ""
            }`}
            style={{
              color:
                sessionRole !== null ? "var(--accent-text)" : "var(--text)",
            }}
          >
            {sessionRole !== null && (
              <span
                className="relative flex h-2.5 w-2.5 shrink-0"
                aria-hidden="true"
              >
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: "var(--accent)" }}
                />
                <span
                  className="relative inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              </span>
            )}
            <Icon.Broadcast size={17} />
            {sessionCode ? formatSessionCode(sessionCode) : "Remote"}
          </button>
          <span className="relative sm:hidden">
            <IconButton
              label={
                sessionCode
                  ? `Remote session ${formatSessionCode(sessionCode)}`
                  : "Remote session"
              }
              onClick={openSessionModal}
              pressed={sessionRole !== null}
              size={44}
            >
              <Icon.Broadcast size={18} />
            </IconButton>
            {sessionRole !== null && (
              <span
                className="pointer-events-none absolute top-1 right-1 flex h-2.5 w-2.5"
                aria-hidden="true"
              >
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: "var(--accent)" }}
                />
                <span
                  className="relative inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              </span>
            )}
          </span>
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

      {/* Live Session Banner (never covers the player) ---------------- */}
      {sessionRole !== null && sessionCode !== null && (
        <div
          role="region"
          aria-label="Active remote session"
          className="neu-sm mx-auto mt-4 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 sm:px-5 sm:py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="relative flex h-3 w-3 shrink-0"
              aria-hidden="true"
            >
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                style={{ background: "var(--accent)" }}
              />
              <span
                className="relative inline-flex h-3 w-3 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-xs font-extrabold sm:text-sm"
                  style={{ color: "var(--text-strong)" }}
                >
                  {sessionRole === "host"
                    ? "Hosting session"
                    : "Controlling host"}
                </span>
                <span
                  className="neu-inset font-display rounded-lg px-2.5 py-0.5 text-xs font-extrabold tracking-wider sm:text-sm"
                  style={{ color: "var(--accent-text)" }}
                >
                  {formatSessionCode(sessionCode)}
                </span>
                <span
                  className="text-[0.7rem] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {sessionRole === "host"
                    ? sessionConnectedClients > 0
                      ? `· ${sessionConnectedClients} ${
                          sessionConnectedClients === 1 ? "device" : "devices"
                        } connected`
                      : "· Waiting for devices…"
                    : "· Live remote control"}
                </span>
              </div>
              {sessionRole === "host" && lastRemoteAction && (
                <p
                  className="mt-0.5 truncate text-[0.68rem]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Latest remote action: {lastRemoteAction}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={copySessionCode}
              className="neu-btn flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
            >
              <Icon.Copy size={14} />
              Copy code
            </button>
            <button
              type="button"
              onClick={openSessionModal}
              className="neu-btn rounded-xl px-3 py-2 text-xs font-bold"
            >
              {sessionRole === "host" ? "Share" : "Info"}
            </button>
            <button
              type="button"
              onClick={
                sessionRole === "host"
                  ? endHostSession
                  : () => leaveRemoteSession()
              }
              className="neu-btn rounded-xl px-3 py-2 text-xs font-bold"
              style={{ color: "var(--danger)" }}
            >
              {sessionRole === "host" ? "End" : "Disconnect"}
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto mt-6 grid max-w-6xl gap-5 sm:mt-8 sm:gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-8">
        {/* Now playing ------------------------------------------------ */}
        <section
          aria-label="Player"
          /* min-w-0: grid items default to min-width:auto, which lets long
             track titles push the card wider than the viewport. */
          className="neu min-w-0 rounded-[1.75rem] p-4 min-[360px]:p-5 sm:rounded-[2rem] sm:p-6 lg:sticky lg:top-6 lg:self-start"
        >
          <div className="flex items-center justify-between gap-3">
            <p
              className="font-display text-[0.65rem] font-bold uppercase tracking-[0.3em]"
              style={{ color: "var(--text-muted)" }}
            >
              {sessionRole === "controller"
                ? buffering
                  ? "Host buffering"
                  : playing
                    ? "Playing on host"
                    : "Paused on host"
                : buffering
                  ? "Buffering"
                  : playing
                    ? "Playing now"
                    : "Paused"}
            </p>
            <span
              className="inline-flex items-center gap-2 text-[0.65rem] font-bold"
              style={{ color: "var(--text-muted)" }}
            >
              <span className="tugtog-disc" aria-hidden="true" />
              {sessionRole === "controller" && sessionCode
                ? `Remote · ${formatSessionCode(sessionCode)}`
                : "via YouTube"}
            </span>
          </div>

          {/* The official player is never hidden, masked, or covered while it
              can play, preserving its controls, attribution, and ads. */}
          <div className="-mx-7 mt-5 min-[360px]:-mx-8 sm:mx-0 sm:mt-6">
            <div className="disc-video">
              <div
                ref={mountRef}
                className={
                  sessionRole === "controller"
                    ? "pointer-events-none invisible"
                    : ""
                }
              />
              {!ready && sessionRole !== "controller" && (
                <div className="disc-video__loading">loading player…</div>
              )}
              {sessionRole === "controller" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-slate-950 text-white">
                  {track ? (
                    <>
                      <img
                        src={`https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-55"
                        draggable={false}
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(10,12,24,0.35) 0%, rgba(10,12,24,0.82) 100%)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={toggle}
                        aria-label={
                          playing ? "Pause host player" : "Play on host player"
                        }
                        className="relative z-10 flex flex-col items-center gap-2.5 rounded-2xl px-5 py-3 text-center transition-transform active:scale-95"
                      >
                        <span
                          className="grid h-14 w-14 place-items-center rounded-full shadow-lg"
                          style={{
                            background: "var(--accent-fill)",
                            color: "#fff",
                          }}
                        >
                          {playing ? (
                            <Icon.Pause size={24} />
                          ) : (
                            <Icon.Play size={24} />
                          )}
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-[0.68rem] font-bold tracking-wider uppercase backdrop-blur-sm">
                          {playing && <Equalizer />}
                          {playing
                            ? "Playing on host screen"
                            : "Paused on host screen"}
                        </span>
                      </button>
                    </>
                  ) : (
                    <div className="px-6 text-center">
                      <p className="text-xs font-bold tracking-widest uppercase text-white/80">
                        Remote Controller Connected
                      </p>
                      <p className="mt-1.5 text-xs text-white/60">
                        Add or select a song below to start playback on the host
                        device.
                      </p>
                    </div>
                  )}
                </div>
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
          <div className="mt-5 flex items-center justify-center gap-1.5 min-[360px]:gap-2.5 sm:gap-4">
            <IconButton
              label={shuffle ? "Shuffle on" : "Shuffle off"}
              onClick={() => {
                const nextShuffle = !shuffle
                setShuffle(nextShuffle)
                if (sessionRoleRef.current === "controller") {
                  sendRemoteCommand({ type: "setShuffle", shuffle: nextShuffle })
                }
                notify(nextShuffle ? "Shuffle on" : "Shuffle off")
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
              onClick={() => {
                const nextMuted = !muted
                setMuted(nextMuted)
                if (sessionRoleRef.current === "controller") {
                  sendRemoteCommand({ type: "setMuted", muted: nextMuted })
                }
              }}
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
                  const rounded = Math.round(v)
                  setMuted(false)
                  setVolume(rounded)
                  if (
                    sessionRoleRef.current === "controller" &&
                    Date.now() - volumeCmdThrottleRef.current > 120
                  ) {
                    volumeCmdThrottleRef.current = Date.now()
                    sendRemoteCommand({
                      type: "setVolume",
                      volume: rounded,
                      muted: false,
                    })
                  }
                }}
                onCommit={(v) => {
                  const rounded = Math.round(v)
                  setMuted(false)
                  setVolume(rounded)
                  if (sessionRoleRef.current === "controller") {
                    sendRemoteCommand({
                      type: "setVolume",
                      volume: rounded,
                      muted: false,
                    })
                  }
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
                {sessionRole === "controller" ? "Host queue" : "Your queue"}
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
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    addTrack()
                  }
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
          Tugtog plays through YouTube’s official visible player, so views
          and ads count normally. Playback pauses whenever the page is hidden.
          Opening Search or Playlists also pauses the visible player.
        </p>
        <nav className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
          <a href="https://www.youtube.com/t/terms" rel="noreferrer">
            YouTube Terms
          </a>
        </nav>
      </footer>

      <SearchModal
        playlists={savedPlaylists}
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
        onUpdate={updateSavedPlaylist}
        onCreate={createSavedPlaylist}
        searchEndpoint={SEARCH_PROXY}
        currentId={currentId}
      />

      <SessionModal
        open={sessionOpen}
        onClose={closeSessionModal}
        role={sessionRole}
        sessionCode={sessionCode}
        connectedClients={sessionConnectedClients}
        lastRemoteAction={lastRemoteAction}
        busy={sessionBusy}
        error={sessionError}
        onClearError={() => setSessionError("")}
        onStartSession={() => void startHostSession()}
        onJoinSession={(input) => void joinRemoteSession(input)}
        onEndSession={endHostSession}
        onLeaveSession={() => leaveRemoteSession()}
        onCopyCode={() => void copySessionCode()}
        onCopyShareLink={() => void copySessionShareLink()}
        onNativeShare={() => void shareSessionLink()}
        queueCount={tracks.length}
        playlistsCount={savedPlaylists.length}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
