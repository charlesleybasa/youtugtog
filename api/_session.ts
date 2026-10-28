export type SessionTrack = {
  id: string
  title: string
  artist: string
}

export type SessionPlaylist = {
  id: string
  name: string
  tracks: SessionTrack[]
  savedAt: string
}

export type SessionRepeat = "off" | "all" | "one"

export type SessionSnapshot = {
  tracks: SessionTrack[]
  currentId: string | null
  playing: boolean
  buffering: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  repeat: SessionRepeat
  shuffle: boolean
  playlists: SessionPlaylist[]
  updatedAt: number
  rev: number
}

export type SessionCommandPayload =
  | { type: "togglePlay" }
  | { type: "setPlaying"; playing: boolean }
  | { type: "playTrack"; id: string }
  | { type: "advance"; delta: number }
  | { type: "seekTo"; seconds: number }
  | { type: "setVolume"; volume: number; muted?: boolean }
  | { type: "setMuted"; muted: boolean }
  | { type: "setShuffle"; shuffle: boolean }
  | { type: "setRepeat"; repeat: SessionRepeat }
  | { type: "addTrackById"; id: string }
  | { type: "addSearchResult"; track: SessionTrack }
  | { type: "playSearchResult"; track: SessionTrack }
  | { type: "deleteTrack"; id: string }
  | {
      type: "restoreTrack"
      track: SessionTrack
      index: number
      wasCurrent: boolean
    }
  | { type: "moveTrack"; id: string; delta: number }
  | { type: "reorderTo"; dragId: string; targetId: string }
  | { type: "playPlaylist"; playlist: SessionPlaylist }
  | {
      type: "restoreQueue"
      tracks: SessionTrack[]
      currentId: string | null
      playing: boolean
    }
  | { type: "appendPlaylist"; playlist: SessionPlaylist }
  | { type: "saveCurrentQueue"; name: string }
  | { type: "createPlaylist"; name: string; tracks: SessionTrack[] }
  | { type: "updatePlaylist"; playlist: SessionPlaylist }
  | { type: "deletePlaylist"; id: string }
  | { type: "restorePlaylist"; playlist: SessionPlaylist; index: number }

export type SessionCommand = {
  id: string
  clientId: string
  createdAt: number
  payload: SessionCommandPayload
}

export type SessionStreamEvent =
  | {
      type: "snapshot"
      snapshot: SessionSnapshot
      connectedClients: number
      ackCommandIds: string[]
    }
  | {
      type: "commands"
      commands: SessionCommand[]
      connectedClients: number
    }
  | {
      type: "presence"
      connectedClients: number
    }
  | {
      type: "ended"
    }

type SessionListener = (event: SessionStreamEvent) => void

type SessionRecord = {
  code: string
  hostId: string
  snapshot: SessionSnapshot
  pendingCommands: SessionCommand[]
  ackCommandIds: string[]
  clients: Map<string, number>
  listeners: Set<SessionListener>
  createdAt: number
  updatedAt: number
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const SESSION_TTL_MS = 6 * 60 * 60 * 1000
const CLIENT_ACTIVE_TTL_MS = 35 * 1000
const MAX_PENDING_COMMANDS = 100
const MAX_ACK_HISTORY = 80

const sessions = new Map<string, SessionRecord>()

export function normalizeSessionCode(raw: string | undefined | null): string {
  if (!raw) return ""
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

export function isValidSessionCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code)
}

export function generateSessionCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = ""
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * CODE_ALPHABET.length)
      code += CODE_ALPHABET[idx]
    }
    if (!sessions.has(code)) return code
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X")
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [code, record] of sessions.entries()) {
    if (now - record.updatedAt > SESSION_TTL_MS) {
      sessions.delete(code)
    }
  }
}

function countActiveClients(record: SessionRecord, now = Date.now()): number {
  for (const [clientId, seenAt] of record.clients.entries()) {
    if (now - seenAt > CLIENT_ACTIVE_TTL_MS) {
      record.clients.delete(clientId)
    }
  }
  return record.clients.size
}

function notifyListeners(record: SessionRecord, event: SessionStreamEvent) {
  for (const listener of record.listeners) {
    try {
      listener(event)
    } catch {
      /* listener closed */
    }
  }
}

export function createSession(
  hostId: string,
  snapshot: SessionSnapshot,
  requestedCode?: string,
) {
  pruneExpiredSessions()
  const normalizedRequested = normalizeSessionCode(requestedCode)
  const code =
    normalizedRequested && isValidSessionCode(normalizedRequested)
      ? normalizedRequested
      : generateSessionCode()

  const now = Date.now()
  const existing = sessions.get(code)
  const record: SessionRecord = {
    code,
    hostId,
    snapshot: { ...snapshot, updatedAt: now },
    pendingCommands: existing?.pendingCommands ?? [],
    ackCommandIds: existing?.ackCommandIds ?? [],
    clients: existing?.clients ?? new Map(),
    listeners: existing?.listeners ?? new Set(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  sessions.set(code, record)

  return {
    code,
    hostId,
    snapshot: record.snapshot,
    connectedClients: countActiveClients(record, now),
    ackCommandIds: record.ackCommandIds,
  }
}

export function joinSession(rawCode: string, clientId: string) {
  pruneExpiredSessions()
  const code = normalizeSessionCode(rawCode)
  if (!isValidSessionCode(code)) return null
  const record = sessions.get(code)
  if (!record) return null

  const now = Date.now()
  if (clientId) {
    const hadClient = record.clients.has(clientId)
    record.clients.set(clientId, now)
    const connectedClients = countActiveClients(record, now)
    if (!hadClient) {
      notifyListeners(record, { type: "presence", connectedClients })
    }
  }

  return {
    code: record.code,
    snapshot: record.snapshot,
    connectedClients: countActiveClients(record, now),
    ackCommandIds: record.ackCommandIds,
  }
}

export function getSessionState(
  rawCode: string,
  role?: string,
  clientId?: string,
) {
  pruneExpiredSessions()
  const code = normalizeSessionCode(rawCode)
  if (!isValidSessionCode(code)) return null
  const record = sessions.get(code)
  if (!record) return null

  const now = Date.now()
  if (role === "controller" && clientId) {
    const hadClient = record.clients.has(clientId)
    record.clients.set(clientId, now)
    const connectedClients = countActiveClients(record, now)
    if (!hadClient) {
      notifyListeners(record, { type: "presence", connectedClients })
    }
  } else if (role === "host") {
    record.updatedAt = now
  }

  return {
    code: record.code,
    snapshot: record.snapshot,
    pendingCommands: record.pendingCommands,
    ackCommandIds: record.ackCommandIds,
    connectedClients: countActiveClients(record, now),
  }
}

export function syncSession(
  rawCode: string,
  hostId: string,
  snapshot: SessionSnapshot,
  ackCommandIds?: string[],
) {
  pruneExpiredSessions()
  const code = normalizeSessionCode(rawCode)
  if (!isValidSessionCode(code)) return null

  const now = Date.now()
  let record = sessions.get(code)
  if (!record) {
    record = {
      code,
      hostId,
      snapshot: { ...snapshot, updatedAt: now },
      pendingCommands: [],
      ackCommandIds: [],
      clients: new Map(),
      listeners: new Set(),
      createdAt: now,
      updatedAt: now,
    }
    sessions.set(code, record)
  }

  if (Array.isArray(ackCommandIds) && ackCommandIds.length > 0) {
    const ackSet = new Set(ackCommandIds)
    record.pendingCommands = record.pendingCommands.filter(
      (cmd) => !ackSet.has(cmd.id),
    )
    for (const id of ackCommandIds) {
      if (!record.ackCommandIds.includes(id)) {
        record.ackCommandIds.push(id)
      }
    }
    if (record.ackCommandIds.length > MAX_ACK_HISTORY) {
      record.ackCommandIds = record.ackCommandIds.slice(-MAX_ACK_HISTORY)
    }
  }

  record.snapshot = { ...snapshot, updatedAt: now }
  record.updatedAt = now
  const connectedClients = countActiveClients(record, now)

  notifyListeners(record, {
    type: "snapshot",
    snapshot: record.snapshot,
    connectedClients,
    ackCommandIds: record.ackCommandIds,
  })

  return {
    code: record.code,
    pendingCommands: record.pendingCommands,
    ackCommandIds: record.ackCommandIds,
    connectedClients,
  }
}

export function enqueueSessionCommand(
  rawCode: string,
  clientId: string,
  command: SessionCommand,
) {
  pruneExpiredSessions()
  const code = normalizeSessionCode(rawCode)
  if (!isValidSessionCode(code)) return null
  const record = sessions.get(code)
  if (!record) return null

  const now = Date.now()
  if (clientId) {
    record.clients.set(clientId, now)
  }

  const alreadyQueued = record.pendingCommands.some(
    (item) => item.id === command.id,
  )
  const alreadyAcked = record.ackCommandIds.includes(command.id)

  if (!alreadyQueued && !alreadyAcked) {
    record.pendingCommands.push(command)
    if (record.pendingCommands.length > MAX_PENDING_COMMANDS) {
      record.pendingCommands = record.pendingCommands.slice(
        -MAX_PENDING_COMMANDS,
      )
    }
  }

  record.updatedAt = now
  const connectedClients = countActiveClients(record, now)

  if (!alreadyQueued && !alreadyAcked) {
    notifyListeners(record, {
      type: "commands",
      commands: [command],
      connectedClients,
    })
  }

  return {
    ok: true,
    connectedClients,
  }
}

export function leaveSession(rawCode: string, clientId: string) {
  const code = normalizeSessionCode(rawCode)
  const record = sessions.get(code)
  if (!record) return { ok: true, connectedClients: 0 }
  if (clientId) {
    record.clients.delete(clientId)
  }
  const connectedClients = countActiveClients(record)
  notifyListeners(record, { type: "presence", connectedClients })
  return { ok: true, connectedClients }
}

export function endSession(rawCode: string, hostId?: string) {
  const code = normalizeSessionCode(rawCode)
  const record = sessions.get(code)
  if (!record) return { ok: true }
  if (hostId && record.hostId && record.hostId !== hostId) {
    return { ok: false }
  }
  notifyListeners(record, { type: "ended" })
  sessions.delete(code)
  return { ok: true }
}

export function subscribeSession(
  rawCode: string,
  role: string | undefined,
  clientId: string | undefined,
  listener: SessionListener,
): (() => void) | null {
  const code = normalizeSessionCode(rawCode)
  const record = sessions.get(code)
  if (!record) return null

  const now = Date.now()
  if (role === "controller" && clientId) {
    record.clients.set(clientId, now)
  }
  record.listeners.add(listener)
  const connectedClients = countActiveClients(record, now)
  notifyListeners(record, { type: "presence", connectedClients })

  return () => {
    record.listeners.delete(listener)
    if (role === "controller" && clientId) {
      record.clients.delete(clientId)
      const remaining = countActiveClients(record)
      notifyListeners(record, { type: "presence", connectedClients: remaining })
    }
  }
}

export function clearAllSessionsForTest() {
  sessions.clear()
}
