import type {
  SessionCommand,
  SessionCommandPayload,
  SessionPlaylist,
  SessionRepeat,
  SessionSnapshot,
  SessionStreamEvent,
  SessionTrack,
} from "../api/_session"

export type {
  SessionCommand,
  SessionCommandPayload,
  SessionPlaylist,
  SessionRepeat,
  SessionSnapshot,
  SessionStreamEvent,
  SessionTrack,
}

export type SessionRole = "host" | "controller" | null

const SESSION_ENDPOINT = "/api/session"
const BROADCAST_CHANNEL_NAME = "tugtog:remote:v1"
const LOCAL_BACKUP_PREFIX = "tugtog:remote:session:"
const ACTIVE_SESSION_KEY = "tugtog:active-session:v1"
const CLIENT_ID_KEY = "tugtog:client-id:v1"
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export function getOrCreateClientId(): string {
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const created =
      globalThis.crypto?.randomUUID?.() ??
      `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    sessionStorage.setItem(CLIENT_ID_KEY, created)
    return created
  } catch {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

export function createCommandId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  )
}

export function generateLocalSessionCode(): string {
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export function formatSessionCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (clean.length === 6) {
    return `${clean.slice(0, 3)}-${clean.slice(3)}`
  }
  return clean
}

export function parseSessionCodeInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (trimmed.includes("session=") || /^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed, window.location.origin)
      const fromParam = url.searchParams.get("session")
      if (fromParam) {
        const cleanParam = fromParam
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
        if (/^[A-Z0-9]{6}$/.test(cleanParam)) return cleanParam
      }
    } catch {
      /* fall through to direct code parsing */
    }
  }

  const clean = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return /^[A-Z0-9]{6}$/.test(clean) ? clean : null
}

export function buildSessionShareUrl(code: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set("session", code)
  return url.toString()
}

export type PersistedActiveSession = {
  role: "host" | "controller"
  code: string
}

export function loadActiveSession(): PersistedActiveSession | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedActiveSession>
    if (
      (parsed.role === "host" || parsed.role === "controller") &&
      typeof parsed.code === "string" &&
      /^[A-Z0-9]{6}$/.test(parsed.code)
    ) {
      return { role: parsed.role, code: parsed.code }
    }
    return null
  } catch {
    return null
  }
}

export function saveActiveSession(session: PersistedActiveSession | null) {
  try {
    if (!session) sessionStorage.removeItem(ACTIVE_SESSION_KEY)
    else sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session))
  } catch {
    /* ignore storage errors */
  }
}

type LocalSessionBackup = {
  code: string
  snapshot: SessionSnapshot
  ackCommandIds: string[]
  updatedAt: number
}

export function saveLocalSessionBackup(
  code: string,
  snapshot: SessionSnapshot,
  ackCommandIds: string[],
) {
  try {
    const payload: LocalSessionBackup = {
      code,
      snapshot,
      ackCommandIds,
      updatedAt: Date.now(),
    }
    localStorage.setItem(LOCAL_BACKUP_PREFIX + code, JSON.stringify(payload))
  } catch {
    /* ignore storage quota errors */
  }
}

export function loadLocalSessionBackup(
  code: string,
): LocalSessionBackup | null {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_PREFIX + code)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalSessionBackup
    if (
      !parsed ||
      parsed.code !== code ||
      !parsed.snapshot ||
      Date.now() - parsed.updatedAt > 6 * 60 * 60 * 1000
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function removeLocalSessionBackup(code: string) {
  try {
    localStorage.removeItem(LOCAL_BACKUP_PREFIX + code)
  } catch {
    /* ignore */
  }
}

export type BroadcastEnvelope =
  | {
      type: "snapshot"
      code: string
      snapshot: SessionSnapshot
      ackCommandIds: string[]
    }
  | {
      type: "command"
      code: string
      command: SessionCommand
    }
  | {
      type: "join"
      code: string
      clientId: string
    }
  | {
      type: "leave"
      code: string
      clientId: string
    }
  | {
      type: "ended"
      code: string
    }

const PEER_CDN_URL = "https://esm.sh/peerjs@1.5.4"
let cachedPeerCtor: any = null

async function loadPeerConstructor(): Promise<any> {
  if (cachedPeerCtor) return cachedPeerCtor
  if (typeof window === "undefined") return null
  try {
    const mod = await import(/* @vite-ignore */ PEER_CDN_URL)
    cachedPeerCtor = mod?.Peer ?? mod?.default ?? null
    return cachedPeerCtor
  } catch {
    return null
  }
}

function hostPeerId(code: string): string {
  return `tugtog-host-${code.toUpperCase()}`
}

export function openSessionBroadcast(
  onMessage: (msg: BroadcastEnvelope) => void,
  options?: {
    code: string
    role: "host" | "controller"
    clientId: string
    getLatestSnapshotEnvelope?: () => BroadcastEnvelope | null
  },
): {
  post: (msg: BroadcastEnvelope) => void
  close: () => void
} {
  let channel: BroadcastChannel | null = null
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      channel.onmessage = (event: MessageEvent<BroadcastEnvelope>) => {
        if (event.data && typeof event.data.type === "string") {
          onMessage(event.data)
        }
      }
    }
  } catch {
    channel = null
  }

  let closed = false
  let peerInstance: any = null
  const hostConnections = new Set<any>()
  let controllerConn: any = null
  const pendingControllerQueue: BroadcastEnvelope[] = []

  if (options) {
    const { code, role, clientId, getLatestSnapshotEnvelope } = options
    void loadPeerConstructor().then((PeerCtor) => {
      if (closed || !PeerCtor) return
      try {
        if (role === "host") {
          const peer = new PeerCtor(hostPeerId(code))
          peerInstance = peer
          peer.on("connection", (conn: any) => {
            if (closed) return
            hostConnections.add(conn)
            conn.on("open", () => {
              onMessage({
                type: "join",
                code,
                clientId: conn.peer || `peer-${Date.now()}`,
              })
              const initialEnv = getLatestSnapshotEnvelope?.()
              if (initialEnv) {
                try {
                  conn.send(initialEnv)
                } catch {
                  /* ignore */
                }
              }
            })
            conn.on("data", (data: unknown) => {
              if (
                data &&
                typeof data === "object" &&
                typeof (data as BroadcastEnvelope).type === "string"
              ) {
                onMessage(data as BroadcastEnvelope)
              }
            })
            const cleanupConn = () => {
              hostConnections.delete(conn)
              onMessage({
                type: "leave",
                code,
                clientId: conn.peer || "",
              })
            }
            conn.on("close", cleanupConn)
            conn.on("error", cleanupConn)
          })
        } else if (role === "controller") {
          const peer = new PeerCtor()
          peerInstance = peer
          peer.on("open", () => {
            if (closed) return
            const conn = peer.connect(hostPeerId(code), { reliable: true })
            controllerConn = conn
            conn.on("open", () => {
              try {
                conn.send({ type: "join", code, clientId })
                while (pendingControllerQueue.length > 0) {
                  const next = pendingControllerQueue.shift()
                  if (next) conn.send(next)
                }
              } catch {
                /* ignore */
              }
            })
            conn.on("data", (data: unknown) => {
              if (
                data &&
                typeof data === "object" &&
                typeof (data as BroadcastEnvelope).type === "string"
              ) {
                const env = data as BroadcastEnvelope
                if (env.type === "snapshot") {
                  saveLocalSessionBackup(
                    env.code,
                    env.snapshot,
                    env.ackCommandIds,
                  )
                }
                onMessage(env)
              }
            })
          })
        }
      } catch {
        /* ignore peer setup error */
      }
    })
  }

  return {
    post(msg: BroadcastEnvelope) {
      try {
        channel?.postMessage(msg)
      } catch {
        /* ignore */
      }
      if (options?.role === "host") {
        for (const conn of hostConnections) {
          try {
            if (conn.open) conn.send(msg)
          } catch {
            /* ignore */
          }
        }
      } else if (options?.role === "controller") {
        try {
          if (controllerConn?.open) {
            controllerConn.send(msg)
          } else {
            pendingControllerQueue.push(msg)
          }
        } catch {
          /* ignore */
        }
      }
    },
    close() {
      closed = true
      try {
        channel?.close()
      } catch {
        /* ignore */
      }
      try {
        controllerConn?.close?.()
        for (const conn of hostConnections) {
          conn?.close?.()
        }
        hostConnections.clear()
        peerInstance?.destroy?.()
      } catch {
        /* ignore */
      }
    },
  }
}

export async function apiCreateSession(
  hostId: string,
  snapshot: SessionSnapshot,
  requestedCode?: string,
): Promise<{
  code: string
  snapshot: SessionSnapshot
  connectedClients: number
  ackCommandIds: string[]
}> {
  try {
    const res = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        hostId,
        code: requestedCode,
        snapshot,
      }),
    })
    if (res.ok) {
      return await res.json()
    }
  } catch {
    /* fallback to local session */
  }

  const fallbackCode = requestedCode ?? generateLocalSessionCode()
  return {
    code: fallbackCode,
    snapshot,
    connectedClients: 0,
    ackCommandIds: [],
  }
}

async function tryJoinViaWebRtcPeer(
  code: string,
  clientId: string,
): Promise<{
  code: string
  snapshot: SessionSnapshot
  connectedClients: number
  ackCommandIds: string[]
} | null> {
  const PeerCtor = await loadPeerConstructor()
  if (!PeerCtor) return null

  return new Promise((resolve) => {
    let settled = false
    let peer: any = null
    const finish = (
      result: {
        code: string
        snapshot: SessionSnapshot
        connectedClients: number
        ackCommandIds: string[]
      } | null,
    ) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        peer?.destroy?.()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    const timer = window.setTimeout(() => finish(null), 4000)

    try {
      peer = new PeerCtor()
      peer.on("error", () => finish(null))
      peer.on("open", () => {
        if (settled) return
        const conn = peer.connect(hostPeerId(code), { reliable: true })
        conn.on("error", () => finish(null))
        conn.on("open", () => {
          try {
            conn.send({ type: "join", code, clientId })
          } catch {
            /* ignore */
          }
        })
        conn.on("data", (data: unknown) => {
          if (
            data &&
            typeof data === "object" &&
            (data as BroadcastEnvelope).type === "snapshot"
          ) {
            const env = data as Extract<
              BroadcastEnvelope,
              { type: "snapshot" }
            >
            saveLocalSessionBackup(env.code, env.snapshot, env.ackCommandIds)
            finish({
              code: env.code,
              snapshot: env.snapshot,
              connectedClients: 1,
              ackCommandIds: env.ackCommandIds,
            })
          }
        })
      })
    } catch {
      finish(null)
    }
  })
}

export async function apiJoinSession(
  code: string,
  clientId: string,
): Promise<{
  code: string
  snapshot: SessionSnapshot
  connectedClients: number
  ackCommandIds: string[]
} | null> {
  try {
    const res = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "join",
        code,
        clientId,
      }),
    })
    if (res.ok) {
      return await res.json()
    }
  } catch {
    /* fallback to local backup or WebRTC peer */
  }

  const backup = loadLocalSessionBackup(code)
  if (backup) {
    return {
      code: backup.code,
      snapshot: backup.snapshot,
      connectedClients: 1,
      ackCommandIds: backup.ackCommandIds,
    }
  }

  return await tryJoinViaWebRtcPeer(code, clientId)
}

export async function apiSyncSession(
  code: string,
  hostId: string,
  snapshot: SessionSnapshot,
  ackCommandIds: string[],
): Promise<{
  pendingCommands: SessionCommand[]
  ackCommandIds: string[]
  connectedClients: number
} | null> {
  try {
    const res = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sync",
        code,
        hostId,
        snapshot,
        ackCommandIds,
      }),
    })
    if (res.ok) {
      return await res.json()
    }
  } catch {
    /* ignore transient network error */
  }
  return null
}

export async function apiPollSession(
  code: string,
  role: "host" | "controller",
  clientId: string,
): Promise<{
  snapshot: SessionSnapshot
  pendingCommands: SessionCommand[]
  ackCommandIds: string[]
  connectedClients: number
} | null> {
  try {
    const params = new URLSearchParams({
      code,
      role,
      clientId,
    })
    const res = await fetch(`${SESSION_ENDPOINT}?${params.toString()}`)
    if (res.ok) {
      return await res.json()
    }
  } catch {
    /* fallback to local backup */
  }

  const backup = loadLocalSessionBackup(code)
  if (backup) {
    return {
      snapshot: backup.snapshot,
      pendingCommands: [],
      ackCommandIds: backup.ackCommandIds,
      connectedClients: 1,
    }
  }
  return null
}

export async function apiSendCommand(
  code: string,
  clientId: string,
  command: SessionCommand,
): Promise<boolean> {
  try {
    const res = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "command",
        code,
        clientId,
        command,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function apiLeaveSession(
  code: string,
  clientId: string,
): Promise<void> {
  try {
    await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "leave",
        code,
        clientId,
      }),
    })
  } catch {
    /* ignore */
  }
}

export async function apiEndSession(
  code: string,
  hostId: string,
): Promise<void> {
  try {
    await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "end",
        code,
        hostId,
      }),
    })
  } catch {
    /* ignore */
  }
}

export function openSessionEventStream(
  code: string,
  role: "host" | "controller",
  clientId: string,
  onEvent: (event: SessionStreamEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {}
  const params = new URLSearchParams({
    code,
    role,
    clientId,
    stream: "1",
  })
  let es: EventSource | null = null
  try {
    es = new EventSource(`${SESSION_ENDPOINT}?${params.toString()}`)
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as SessionStreamEvent
        if (parsed && typeof parsed.type === "string") {
          onEvent(parsed)
        }
      } catch {
        /* ignore malformed event */
      }
    }
  } catch {
    es = null
  }
  return () => {
    try {
      es?.close()
    } catch {
      /* ignore */
    }
  }
}

export function describeRemoteCommand(
  payload: SessionCommandPayload,
): { toast?: string; label: string } {
  switch (payload.type) {
    case "togglePlay":
      return { label: "Play / Pause toggled" }
    case "setPlaying":
      return { label: payload.playing ? "Resumed playback" : "Paused playback" }
    case "playTrack":
      return { label: "Switched track" }
    case "advance":
      return { label: payload.delta > 0 ? "Skipped to next song" : "Previous song" }
    case "seekTo":
      return { label: "Seeked track position" }
    case "setVolume":
      return { label: `Volume set to ${Math.round(payload.volume)}%` }
    case "setMuted":
      return { label: payload.muted ? "Muted audio" : "Unmuted audio" }
    case "setShuffle":
      return {
        toast: payload.shuffle ? "Remote turned shuffle on" : "Remote turned shuffle off",
        label: payload.shuffle ? "Shuffle on" : "Shuffle off",
      }
    case "setRepeat":
      return {
        label: `Repeat: ${payload.repeat}`,
      }
    case "addTrackById":
      return {
        toast: "Remote added a YouTube link to queue",
        label: "Added YouTube link",
      }
    case "addSearchResult":
      return {
        toast: `Remote queued “${payload.track.title}”`,
        label: `Queued “${payload.track.title}”`,
      }
    case "playSearchResult":
      return {
        toast: `Remote playing “${payload.track.title}”`,
        label: `Playing “${payload.track.title}”`,
      }
    case "deleteTrack":
      return {
        toast: "Remote removed a song from the queue",
        label: "Removed song from queue",
      }
    case "restoreTrack":
      return {
        toast: `Remote restored “${payload.track.title}”`,
        label: `Restored “${payload.track.title}”`,
      }
    case "moveTrack":
    case "reorderTo":
      return { label: "Reordered queue" }
    case "playPlaylist":
      return {
        toast: `Remote playing playlist “${payload.playlist.name}”`,
        label: `Playing “${payload.playlist.name}”`,
      }
    case "restoreQueue":
      return {
        toast: "Remote restored previous queue",
        label: "Restored previous queue",
      }
    case "appendPlaylist":
      return {
        toast: `Remote added songs from “${payload.playlist.name}”`,
        label: `Added songs from “${payload.playlist.name}”`,
      }
    case "saveCurrentQueue":
      return {
        toast: `Remote saved queue as “${payload.name}”`,
        label: `Saved queue “${payload.name}”`,
      }
    case "createPlaylist":
      return {
        toast: `Remote created playlist “${payload.name}”`,
        label: `Created playlist “${payload.name}”`,
      }
    case "updatePlaylist":
      return {
        toast: `Remote updated playlist “${payload.playlist.name}”`,
        label: `Updated playlist “${payload.playlist.name}”`,
      }
    case "deletePlaylist":
      return {
        toast: "Remote deleted a playlist",
        label: "Deleted playlist",
      }
    case "restorePlaylist":
      return {
        toast: `Remote restored playlist “${payload.playlist.name}”`,
        label: `Restored playlist “${payload.playlist.name}”`,
      }
  }
}
