import { useEffect, useRef, useState } from "react"

type Track = { id: string; title: string; artist: string }

export type SavedPlaylist = {
  id: string
  name: string
  tracks: Track[]
  savedAt: string
}

type View = "library" | "save"

const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

const ModalIcon = {
  Back: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m14.5 5-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Close: () => (
    <svg
      width="18"
      height="18"
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
  Library: () => (
    <svg
      width="19"
      height="19"
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
  Play: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8.4 5.2a1 1 0 0 1 1.53-.85l8.2 5.15a1.77 1.77 0 0 1 0 3l-8.2 5.15a1 1 0 0 1-1.53-.85z" />
    </svg>
  ),
  Plus: () => (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  ),
  Save: () => (
    <svg
      width="18"
      height="18"
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
  Trash: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6.5h16M9 6.5V4.7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.8m-8.5 0 .8 13a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-13"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
}

function PlaylistCover({
  tracks,
  size = "large",
}: {
  tracks: Track[]
  size?: "large" | "small"
}) {
  const visible = tracks.slice(0, 4)
  const single = visible.length === 1
  return (
    <div
      className={`grid shrink-0 overflow-hidden rounded-2xl ${
        single ? "grid-cols-1" : "grid-cols-2"
      } ${
        size === "large"
          ? "h-24 w-24 sm:h-28 sm:w-28"
          : "h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]"
      }`}
      style={{ background: "var(--sh-dark)" }}
      aria-hidden="true"
    >
      {visible.map((track) => (
        <img
          key={track.id}
          src={thumbnail(track.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full min-h-0 w-full object-cover"
          draggable={false}
        />
      ))}
    </div>
  )
}

function savedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Saved recently"
  return `Saved ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date)}`
}

export default function SavedPlaylistsModal({
  open,
  view,
  onViewChange,
  onClose,
  playlists,
  currentTracks,
  defaultName,
  onSave,
  onPlay,
  onAppend,
  onDelete,
}: {
  open: boolean
  view: View
  onViewChange: (view: View) => void
  onClose: () => void
  playlists: SavedPlaylist[]
  currentTracks: Track[]
  defaultName: string
  onSave: (name: string) => void
  onPlay: (playlist: SavedPlaylist) => void
  onAppend: (playlist: SavedPlaylist) => void
  onDelete: (playlist: SavedPlaylist) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState(defaultName)
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<{
    top: number
    height: number
  } | null>(null)

  useEffect(() => {
    if (open && view === "save") setName(defaultName)
  }, [defaultName, open, view])

  useEffect(() => {
    if (!open || view !== "library") setPendingPlayId(null)
  }, [open, view])

  useEffect(() => {
    if (!open) return
    const visualViewport = window.visualViewport
    if (!visualViewport) return
    const update = () =>
      setViewport({
        top: visualViewport.offsetTop,
        height: visualViewport.height,
      })
    update()
    visualViewport.addEventListener("resize", update)
    visualViewport.addEventListener("scroll", update)
    return () => {
      visualViewport.removeEventListener("resize", update)
      visualViewport.removeEventListener("scroll", update)
      setViewport(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusTimer = window.setTimeout(() => {
      if (view === "save") nameRef.current?.focus()
      else
        panelRef.current
          ?.querySelector<HTMLElement>("button:not(:disabled)")
          ?.focus()
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
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [open, onClose, view])

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
        aria-labelledby="saved-playlists-title"
        className="modal-panel neu safe-b relative z-10 flex max-h-full w-full max-w-2xl flex-col rounded-[1.75rem] p-4 sm:rounded-[2rem] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {view === "save" && (
              <button
                type="button"
                onClick={() => onViewChange("library")}
                aria-label="Back to My playlists"
                className="neu-btn grid h-11 w-11 shrink-0 place-items-center rounded-full"
              >
                <ModalIcon.Back />
              </button>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                id="saved-playlists-title"
                className="font-display text-[0.68rem] font-bold uppercase tracking-[0.3em]"
                style={{ color: "var(--text-muted)" }}
              >
                {view === "save" ? "Save this queue" : "My playlists"}
              </p>
              <p
                className="mt-1 text-xs leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {view === "save"
                  ? "Keep this exact order for another listening session."
                  : "Your mixes are saved privately on this device."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close My playlists"
            className="neu-btn grid h-11 w-11 shrink-0 place-items-center rounded-full"
          >
            <ModalIcon.Close />
          </button>
        </div>

        {view === "save" ? (
          <form
            className="mt-5 min-h-0"
            onSubmit={(event) => {
              event.preventDefault()
              const trimmedName = name.trim()
              if (trimmedName) onSave(trimmedName)
            }}
          >
            <div className="neu-inset flex items-center gap-4 rounded-[1.5rem] p-4 sm:p-5">
              <PlaylistCover tracks={currentTracks} />
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs font-bold uppercase tracking-[0.18em]"
                  style={{ color: "var(--accent-text)" }}
                >
                  Queue snapshot
                </p>
                <p
                  className="mt-1 text-sm font-semibold"
                  style={{ color: "var(--text-strong)" }}
                >
                  {currentTracks.length}{" "}
                  {currentTracks.length === 1 ? "song" : "songs"}
                </p>
                <p
                  className="mt-2 line-clamp-2 text-xs leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  {currentTracks
                    .slice(0, 3)
                    .map((track) => track.title)
                    .join(" · ")}
                </p>
              </div>
            </div>

            <label
              htmlFor="playlist-name"
              className="mt-5 block px-1 text-xs font-bold"
              style={{ color: "var(--text-strong)" }}
            >
              Playlist name
            </label>
            <div className="neu-inset mt-2 flex items-center gap-3 rounded-2xl px-4 py-3">
              <span style={{ color: "var(--accent-text)" }}>
                <ModalIcon.Library />
              </span>
              <input
                ref={nameRef}
                id="playlist-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                autoComplete="off"
                className="w-full min-w-0 bg-transparent text-sm font-semibold"
                style={{ color: "var(--text-strong)" }}
              />
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="neu-btn rounded-xl px-5 py-3 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={currentTracks.length === 0 || !name.trim()}
                className="accent-btn flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
              >
                <ModalIcon.Save />
                Save playlist
              </button>
            </div>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onViewChange("save")}
              disabled={currentTracks.length === 0}
              className="accent-btn mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-bold sm:w-fit"
            >
              <ModalIcon.Save />
              Save current queue
            </button>

            <div className="soft-scroll -mx-1 mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
              {playlists.length === 0 ? (
                <div className="neu-inset rounded-[1.5rem] px-6 py-10 text-center">
                  <span
                    className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"
                    style={{ background: "var(--accent-fill)", color: "#fff" }}
                  >
                    <ModalIcon.Library />
                  </span>
                  <p
                    className="mt-4 text-sm font-bold"
                    style={{ color: "var(--text-strong)" }}
                  >
                    Your first mix starts here
                  </p>
                  <p
                    className="mx-auto mt-1 max-w-sm text-xs leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Arrange the queue the way you like, then save it to return
                    to it anytime.
                  </p>
                </div>
              ) : (
                playlists.map((playlist, index) => (
                  <article
                    key={playlist.id}
                    className="rise-in neu-inset rounded-[1.5rem] p-3 sm:p-4"
                    style={{ ["--i" as string]: index }}
                  >
                    <div className="flex items-center gap-3 sm:gap-4">
                      <PlaylistCover tracks={playlist.tracks} size="small" />
                      <div className="min-w-0 flex-1">
                        <h3
                          className="truncate text-sm font-bold"
                          style={{ color: "var(--text-strong)" }}
                          title={playlist.name}
                        >
                          {playlist.name}
                        </h3>
                        <p
                          className="mt-1 text-[0.68rem] font-medium"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {playlist.tracks.length}{" "}
                          {playlist.tracks.length === 1 ? "song" : "songs"} ·{" "}
                          {savedDate(playlist.savedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDelete(playlist)}
                        aria-label={`Delete ${playlist.name}`}
                        className="grid h-11 w-9 shrink-0 place-items-center rounded-full"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <ModalIcon.Trash />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:ml-[5.5rem] sm:flex">
                      <button
                        type="button"
                        onClick={() => {
                          if (currentTracks.length)
                            setPendingPlayId(playlist.id)
                          else onPlay(playlist)
                        }}
                        className="accent-btn flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[0.72rem] font-bold"
                      >
                        <ModalIcon.Play />
                        Play now
                      </button>
                      <button
                        type="button"
                        onClick={() => onAppend(playlist)}
                        className="neu-btn flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[0.72rem] font-bold"
                      >
                        <ModalIcon.Plus />
                        Add to queue
                      </button>
                    </div>
                    {pendingPlayId === playlist.id && (
                      <div
                        className="mt-3 rounded-2xl px-3 py-3 sm:flex sm:items-center sm:justify-between sm:gap-3"
                        style={{ background: "var(--panel-raised)" }}
                        role="alert"
                      >
                        <p
                          className="text-xs font-semibold leading-relaxed"
                          style={{ color: "var(--text-strong)" }}
                        >
                          Replace your current queue and play this mix?
                        </p>
                        <div className="mt-2 flex gap-2 sm:mt-0">
                          <button
                            type="button"
                            onClick={() => setPendingPlayId(null)}
                            className="neu-btn rounded-xl px-3 py-2 text-xs font-bold"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => onPlay(playlist)}
                            className="accent-btn rounded-xl px-3 py-2 text-xs font-bold"
                          >
                            Replace & play
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
