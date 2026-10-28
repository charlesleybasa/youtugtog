import assert from "node:assert/strict"
import test from "node:test"
import type { APIResponse } from "./_http.ts"
import { clearAllSessionsForTest, type SessionSnapshot } from "./_session.ts"
import searchHandler from "./search.ts"
import sessionHandler from "./session.ts"
import videosHandler from "./videos.ts"

class MockResponse implements APIResponse {
  statusCode = 200
  headers = new Map<string, string>()
  body: unknown

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value)
  }

  status(code: number): APIResponse {
    this.statusCode = code
    return this
  }

  json(body: unknown): unknown {
    this.body = body
    return body
  }
}

const originalKey = process.env.YOUTUBE_API_KEY

test.afterEach(() => {
  if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY
  else process.env.YOUTUBE_API_KEY = originalKey
})

test("search returns a normalized error when the server key is missing", async () => {
  delete process.env.YOUTUBE_API_KEY
  const response = new MockResponse()

  await searchHandler({ method: "GET", query: { q: "opm" } }, response)

  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.body, {
    error: {
      code: "service_unconfigured",
      message: "Video search is not configured yet.",
    },
  })
})

test("video details reject malformed identifiers before contacting YouTube", async () => {
  process.env.YOUTUBE_API_KEY = "test-key"
  const response = new MockResponse()

  await videosHandler({ method: "GET", query: { ids: "short" } }, response)

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.body, {
    error: {
      code: "invalid_request",
      message: "Provide between 1 and 50 comma-separated YouTube video IDs.",
    },
  })
})

const sampleSnapshot: SessionSnapshot = {
  tracks: [{ id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley" }],
  currentId: "dQw4w9WgXcQ",
  playing: false,
  buffering: false,
  time: 12,
  duration: 212,
  volume: 80,
  muted: false,
  repeat: "off",
  shuffle: false,
  playlists: [],
  updatedAt: 1000,
  rev: 1,
}

test("session lifecycle creates, joins, enqueues remote commands, and acknowledges on sync", async () => {
  clearAllSessionsForTest()

  const createRes = new MockResponse()
  await sessionHandler(
    {
      method: "POST",
      query: {},
      body: { action: "create", hostId: "host-1", snapshot: sampleSnapshot },
    },
    createRes,
  )
  assert.equal(createRes.statusCode, 200)
  const created = createRes.body as { code: string; connectedClients: number }
  assert.match(created.code, /^[A-Z0-9]{6}$/)
  assert.equal(created.connectedClients, 0)

  const joinRes = new MockResponse()
  await sessionHandler(
    {
      method: "POST",
      query: {},
      body: { action: "join", code: created.code.toLowerCase(), clientId: "client-1" },
    },
    joinRes,
  )
  assert.equal(joinRes.statusCode, 200)
  const joined = joinRes.body as { code: string; connectedClients: number; snapshot: SessionSnapshot }
  assert.equal(joined.code, created.code)
  assert.equal(joined.connectedClients, 1)
  assert.equal(joined.snapshot.currentId, "dQw4w9WgXcQ")

  const cmdRes = new MockResponse()
  await sessionHandler(
    {
      method: "POST",
      query: {},
      body: {
        action: "command",
        code: created.code,
        clientId: "client-1",
        command: {
          id: "cmd-1",
          clientId: "client-1",
          createdAt: 2000,
          payload: { type: "setPlaying", playing: true },
        },
      },
    },
    cmdRes,
  )
  assert.equal(cmdRes.statusCode, 200)

  const pollRes = new MockResponse()
  await sessionHandler(
    { method: "GET", query: { code: created.code, role: "host" } },
    pollRes,
  )
  assert.equal(pollRes.statusCode, 200)
  const polled = pollRes.body as { pendingCommands: Array<{ id: string }> }
  assert.equal(polled.pendingCommands.length, 1)
  assert.equal(polled.pendingCommands[0].id, "cmd-1")

  const syncRes = new MockResponse()
  await sessionHandler(
    {
      method: "POST",
      query: {},
      body: {
        action: "sync",
        code: created.code,
        hostId: "host-1",
        ackCommandIds: ["cmd-1"],
        snapshot: { ...sampleSnapshot, playing: true, rev: 2 },
      },
    },
    syncRes,
  )
  assert.equal(syncRes.statusCode, 200)
  const synced = syncRes.body as { pendingCommands: unknown[]; ackCommandIds: string[] }
  assert.equal(synced.pendingCommands.length, 0)
  assert.deepEqual(synced.ackCommandIds, ["cmd-1"])

  const endRes = new MockResponse()
  await sessionHandler(
    {
      method: "POST",
      query: {},
      body: { action: "end", code: created.code, hostId: "host-1" },
    },
    endRes,
  )
  assert.equal(endRes.statusCode, 200)

  const afterEndRes = new MockResponse()
  await sessionHandler(
    { method: "GET", query: { code: created.code } },
    afterEndRes,
  )
  assert.equal(afterEndRes.statusCode, 404)
})


