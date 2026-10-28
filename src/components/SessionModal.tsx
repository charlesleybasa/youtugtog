import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { formatSessionCode, type SessionRole } from "../sessionSync"

const ModalIcon = {
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
  Broadcast: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path
        d="M8.4 8.4a5.1 5.1 0 0 0 0 7.2M15.6 8.4a5.1 5.1 0 0 1 0 7.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  ),
  Copy: () => (
    <svg
      width="17"
      height="17"
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
  Link: () => (
    <svg
      width="17"
      height="17"
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
  Share: () => (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3v12m0-12-4 4m4-4 4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  Remote: () => (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="6"
        y="2.5"
        width="12"
        height="19"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <circle cx="12" cy="9" r="2.2" fill="currentColor" />
      <path
        d="M9.5 15h5M9.5 18h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ),
}

export default function SessionModal({
  open,
  onClose,
  role,
  sessionCode,
  connectedClients,
  lastRemoteAction,
  busy,
  error,
  onClearError,
  onStartSession,
  onJoinSession,
  onEndSession,
  onLeaveSession,
  onCopyCode,
  onCopyShareLink,
  onNativeShare,
  queueCount,
  playlistsCount,
}: {
  open: boolean
  onClose: () => void
  role: SessionRole
  sessionCode: string | null
  connectedClients: number
  lastRemoteAction: string | null
  busy: boolean
  error: string
  onClearError: () => void
  onStartSession: () => void
  onJoinSession: (codeOrLink: string) => void
  onEndSession: () => void
  onLeaveSession: () => void
  onCopyCode: () => void
  onCopyShareLink: () => void
  onNativeShare?: () => void
  queueCount: number
  playlistsCount: number
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const [joinInput, setJoinInput] = useState("")
  const [viewport, setViewport] = useState<{
    top: number
    height: number
  } | null>(null)

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function"

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

    const focusTimer = window.setTimeout(() => {
      if (role === null && codeInputRef.current) {
        codeInputRef.current.focus()
      } else {
        panelRef.current
          ?.querySelector<HTMLElement>("button:not(:disabled)")
          ?.focus()
      }
    }, 50)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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
  }, [open, onClose, role])

  if (!open) return null

  const formattedCode = sessionCode ? formatSessionCode(sessionCode) : ""
  const codeChars = sessionCode
    ? sessionCode.toUpperCase().replace(/[^A-Z0-9]/g, "").split("")
    : []

  const handleJoinSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!joinInput.trim() || busy) return
    onJoinSession(joinInput)
  }

  const handleCodeInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return
      }
      formRef.current?.requestSubmit()
    }
  }

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
        aria-labelledby="session-modal-title"
        className="modal-panel neu safe-b relative z-10 flex max-h-full w-full max-w-xl flex-col overflow-y-auto rounded-[1.75rem] p-4 sm:rounded-[2rem] sm:p-6"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              id="session-modal-title"
              className="font-display text-[0.68rem] font-bold uppercase tracking-[0.3em]"
              style={{ color: "var(--text-muted)" }}
            >
              {role === "host"
                ? "Live Session · Hosting"
                : role === "controller"
                  ? "Live Session · Remote Control"
                  : "Remote Session"}
            </p>
            <p
              className="mt-1 text-xs leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {role === "host"
                ? "Share this code with another phone, tablet, or browser to control playback, queue, and playlists."
                : role === "controller"
                  ? "This device is controlling the host player in real time."
                  : "Start a session on this player or enter a code to control another device."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close remote session dialog"
            className="neu-btn grid h-11 w-11 shrink-0 place-items-center rounded-full"
          >
            <ModalIcon.Close />
          </button>
        </div>

        {/* Body */}
        {role === "host" && sessionCode ? (
          <div className="mt-5 space-y-4">
            {/* Big room-readable code display */}
            <div className="neu-inset rounded-[1.5rem] p-4 text-center sm:p-5">
              <p
                className="text-[0.68rem] font-bold uppercase tracking-[0.25em]"
                style={{ color: "var(--accent-text)" }}
              >
                Session code
              </p>

              <div
                className="mt-3 flex items-center justify-center gap-1.5 sm:gap-2"
                aria-label={`Session code ${formattedCode}`}
              >
                {codeChars.map((ch, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 sm:gap-2">
                    {idx === 3 && (
                      <span
                        className="font-display text-lg font-extrabold sm:text-2xl"
                        style={{ color: "var(--text-muted)" }}
                        aria-hidden="true"
                      >
                        -
                      </span>
                    )}
                    <span
                      className="neu-sm font-display grid h-12 w-10 place-items-center rounded-xl text-xl font-extrabold sm:h-14 sm:w-12 sm:rounded-2xl sm:text-2xl"
                      style={{ color: "var(--text-strong)" }}
                    >
                      {ch}
                    </span>
                  </div>
                ))}
              </div>

              <p
                className="mt-3 text-xs font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                Open Tugtog on another device, tap{" "}
                <strong style={{ color: "var(--text-strong)" }}>Remote</strong>,
                and enter{" "}
                <strong style={{ color: "var(--text-strong)" }}>
                  {formattedCode}
                </strong>
              </p>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={onCopyCode}
                  className="accent-btn flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold sm:text-sm"
                >
                  <ModalIcon.Copy />
                  Copy code
                </button>
                <button
                  type="button"
                  onClick={onCopyShareLink}
                  className="neu-btn flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold sm:text-sm"
                >
                  <ModalIcon.Link />
                  Copy control link
                </button>
                {canNativeShare && onNativeShare && (
                  <button
                    type="button"
                    onClick={onNativeShare}
                    className="neu-btn flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold sm:text-sm"
                  >
                    <ModalIcon.Share />
                    Share
                  </button>
                )}
              </div>
            </div>

            {/* Live connection status */}
            <div className="neu-inset flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5">
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
                  <p
                    className="truncate text-xs font-bold sm:text-sm"
                    style={{ color: "var(--text-strong)" }}
                  >
                    {connectedClients > 0
                      ? `${connectedClients} remote ${
                          connectedClients === 1 ? "device" : "devices"
                        } connected`
                      : "Waiting for remote devices…"}
                  </p>
                  <p
                    className="mt-0.5 truncate text-[0.7rem]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {lastRemoteAction
                      ? `Latest: ${lastRemoteAction}`
                      : "Controllers can manage the queue, playlists, and playback"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={onEndSession}
                className="neu-btn rounded-xl px-4 py-3 text-sm font-bold"
                style={{ color: "var(--danger)" }}
              >
                End session
              </button>
              <button
                type="button"
                onClick={onClose}
                className="accent-btn rounded-xl px-5 py-3 text-sm font-bold"
              >
                Done · Keep hosting
              </button>
            </div>
          </div>
        ) : role === "controller" && sessionCode ? (
          <div className="mt-5 space-y-4">
            <div className="neu-inset rounded-[1.5rem] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl"
                  style={{ background: "var(--accent-fill)", color: "#fff" }}
                >
                  <ModalIcon.Remote />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[0.68rem] font-bold uppercase tracking-[0.22em]"
                    style={{ color: "var(--accent-text)" }}
                  >
                    Connected to host
                  </p>
                  <p
                    className="font-display mt-0.5 text-lg font-extrabold"
                    style={{ color: "var(--text-strong)" }}
                  >
                    Session {formattedCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCopyCode}
                  className="neu-btn flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
                >
                  <ModalIcon.Copy />
                  Copy
                </button>
              </div>

              <p
                className="mt-3 text-xs leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                Any action you take on this page—playing or pausing songs,
                seeking, adjusting volume, reordering or adding songs to the
                queue, and playing or editing playlists—controls the host device
                immediately.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={onLeaveSession}
                className="neu-btn rounded-xl px-4 py-3 text-sm font-bold"
                style={{ color: "var(--danger)" }}
              >
                Disconnect from host
              </button>
              <button
                type="button"
                onClick={onClose}
                className="accent-btn rounded-xl px-5 py-3 text-sm font-bold"
              >
                Continue controlling
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* Start host session card */}
            <div className="neu-inset rounded-[1.5rem] p-4 sm:p-5">
              <div className="flex items-start gap-3.5">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{ background: "var(--accent-fill)", color: "#fff" }}
                >
                  <ModalIcon.Broadcast />
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    className="text-sm font-extrabold sm:text-base"
                    style={{ color: "var(--text-strong)" }}
                  >
                    Host a session on this device
                  </h2>
                  <p
                    className="mt-1 text-xs leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Keep the player open here and get a 6-character code so
                    other devices can queue songs, switch playlists, and control
                    playback.
                  </p>
                  <p
                    className="mt-2 text-[0.7rem] font-semibold"
                    style={{ color: "var(--accent-text)" }}
                  >
                    Ready to share: {queueCount}{" "}
                    {queueCount === 1 ? "song" : "songs"} in queue ·{" "}
                    {playlistsCount}{" "}
                    {playlistsCount === 1 ? "playlist" : "playlists"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onStartSession}
                disabled={busy}
                className="accent-btn mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold"
              >
                <ModalIcon.Broadcast />
                {busy ? "Starting session…" : "Start live session"}
              </button>
            </div>

            {/* Join existing session card */}
            <form
              ref={formRef}
              onSubmit={handleJoinSubmit}
              className="neu-inset rounded-[1.5rem] p-4 sm:p-5"
            >
              <div className="flex items-start gap-3.5">
                <span
                  className="neu-sm grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{ color: "var(--accent-text)" }}
                >
                  <ModalIcon.Remote />
                </span>
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="session-code-input"
                    className="block text-sm font-extrabold sm:text-base"
                    style={{ color: "var(--text-strong)" }}
                  >
                    Control another device
                  </label>
                  <p
                    className="mt-1 text-xs leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Enter the 6-character session code or paste a control link
                    shared from the host device.
                  </p>
                </div>
              </div>

              <div className="mt-3.5 flex flex-col gap-2 sm:flex-row">
                <div className="neu flex flex-1 items-center rounded-xl px-3.5 py-2.5">
                  <input
                    ref={codeInputRef}
                    id="session-code-input"
                    type="text"
                    value={joinInput}
                    onChange={(e) => {
                      setJoinInput(e.target.value)
                      if (error) onClearError()
                    }}
                    onKeyDown={handleCodeInputKeyDown}
                    placeholder="e.g. K7P-9X2"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    enterKeyHint="go"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "session-join-error" : undefined}
                    className="w-full min-w-0 bg-transparent text-sm font-bold tracking-wider uppercase"
                    style={{ color: "var(--text-strong)" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!joinInput.trim() || busy}
                  className="neu-btn shrink-0 rounded-xl px-5 py-3 text-sm font-bold"
                  style={{ color: "var(--accent-text)" }}
                >
                  {busy ? "Connecting…" : "Connect"}
                </button>
              </div>

              {error && (
                <p
                  id="session-join-error"
                  role="status"
                  aria-live="polite"
                  className="mt-2.5 px-1 text-xs font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  {error}
                </p>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
