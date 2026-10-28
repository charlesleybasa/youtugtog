import assert from "node:assert/strict"
import test from "node:test"
import {
  fetchVideoSummaries,
  isVideoId,
  parseDurationSeconds,
  searchMusicVideos,
  YouTubeUpstreamError,
} from "./_youtube.ts"

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test("validates IDs and parses YouTube durations", () => {
  assert.equal(isVideoId("dQw4w9WgXcQ"), true)
  assert.equal(isVideoId("too-short"), false)
  assert.equal(parseDurationSeconds("PT1H2M3S"), 3_723)
  assert.equal(parseDurationSeconds("P1DT30S"), 86_430)
  assert.equal(parseDurationSeconds("not-a-duration"), 0)
})

test("filters details to public, non-live, embeddable Music videos", async () => {
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    assert.equal(url.pathname, "/youtube/v3/videos")
    assert.equal(url.searchParams.get("part"), "snippet,status,contentDetails")
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "dQw4w9WgXcQ",
            snippet: {
              title: "A &amp; B",
              channelTitle: "Channel",
              categoryId: "10",
              liveBroadcastContent: "none",
              thumbnails: { medium: { url: "https://example.test/thumb.jpg" } },
            },
            contentDetails: { duration: "PT3M33S" },
            status: {
              embeddable: true,
              madeForKids: false,
              privacyStatus: "public",
            },
          },
          {
            id: "M7lc1UVf-VE",
            snippet: {
              title: "Live result",
              channelTitle: "Channel",
              categoryId: "10",
              liveBroadcastContent: "live",
            },
            status: { embeddable: true, privacyStatus: "public" },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }) as typeof fetch

  const result = await fetchVideoSummaries(
    ["M7lc1UVf-VE", "dQw4w9WgXcQ"],
    "test-key",
  )

  assert.deepEqual(result.items.map((item) => item.id), ["dQw4w9WgXcQ"])
  assert.equal(result.items[0].title, "A & B")
  assert.equal(result.items[0].durationSeconds, 213)
  assert.deepEqual(result.rejectedIds, ["M7lc1UVf-VE"])
})

test("search requests Moderate SafeSearch and excludes live candidates", async () => {
  const requestedURLs: URL[] = []
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requestedURLs.push(url)

    if (url.pathname.endsWith("/search")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: { videoId: "dQw4w9WgXcQ" },
              snippet: { liveBroadcastContent: "none" },
            },
            {
              id: { videoId: "M7lc1UVf-VE" },
              snippet: { liveBroadcastContent: "live" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    return new Response(
      JSON.stringify({
        items: [
          {
            id: "dQw4w9WgXcQ",
            snippet: {
              title: "Song",
              channelTitle: "Channel",
              categoryId: "10",
              liveBroadcastContent: "none",
              thumbnails: {},
            },
            contentDetails: { duration: "PT2M" },
            status: { embeddable: true, privacyStatus: "public" },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }) as typeof fetch

  const result = await searchMusicVideos("opm", 8, "test-key")
  const searchURL = requestedURLs[0]

  assert.equal(searchURL.searchParams.get("safeSearch"), "moderate")
  assert.equal(searchURL.searchParams.get("videoCategoryId"), "10")
  assert.equal(searchURL.searchParams.get("videoEmbeddable"), "true")
  assert.equal(searchURL.searchParams.get("videoSyndicated"), "true")
  assert.deepEqual(result.items.map((item) => item.id), ["dQw4w9WgXcQ"])
  assert.equal(requestedURLs[1].searchParams.get("id"), "dQw4w9WgXcQ")
})

test("preserves quota reasons from YouTube failures", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Quota exceeded",
          errors: [{ reason: "quotaExceeded" }],
        },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch

  await assert.rejects(
    () => searchMusicVideos("opm", 8, "test-key"),
    (error: unknown) =>
      error instanceof YouTubeUpstreamError &&
      error.status === 403 &&
      error.reason === "quotaExceeded",
  )
})
