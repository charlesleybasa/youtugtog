export type VideoSummary = {
  id: string
  title: string
  channelTitle: string
  thumbnailURL: string
  durationSeconds: number
  embeddable: boolean
  madeForKids: boolean
  refreshedAt: string
}

type YouTubeThumbnail = { url?: string }

type YouTubeVideo = {
  id?: string
  snippet?: {
    title?: string
    channelTitle?: string
    categoryId?: string
    liveBroadcastContent?: string
    thumbnails?: Record<string, YouTubeThumbnail>
  }
  contentDetails?: { duration?: string }
  status?: {
    embeddable?: boolean
    madeForKids?: boolean
    privacyStatus?: string
  }
}

type YouTubeSearchItem = {
  id?: { videoId?: string }
  snippet?: { liveBroadcastContent?: string }
}

type YouTubeResponse<T> = {
  items?: T[]
  error?: { message?: string; errors?: Array<{ reason?: string }> }
}

export class YouTubeUpstreamError extends Error {
  status: number
  reason?: string

  constructor(message: string, status: number, reason?: string) {
    super(message)
    this.name = "YouTubeUpstreamError"
    this.status = status
    this.reason = reason
  }
}

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value)
}

/** Convert the ISO 8601 duration shape returned by YouTube to whole seconds. */
export function parseDurationSeconds(value: string | undefined): number {
  if (!value) return 0
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  )
  if (!match) return 0
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match
  return Math.round(
    Number(days) * 86400 +
      Number(hours) * 3600 +
      Number(minutes) * 60 +
      Number(seconds),
  )
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function preferredThumbnail(
  thumbnails: Record<string, YouTubeThumbnail> | undefined,
): string {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    ""
  )
}

async function fetchYouTube<T>(url: URL): Promise<YouTubeResponse<T>> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  })
  let data: YouTubeResponse<T>
  try {
    data = (await response.json()) as YouTubeResponse<T>
  } catch {
    throw new YouTubeUpstreamError("YouTube returned an unreadable response.", 502)
  }
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason
    throw new YouTubeUpstreamError(
      data.error?.message || "YouTube could not complete the request.",
      response.status,
      reason,
    )
  }
  return data
}

export async function fetchVideoSummaries(
  ids: string[],
  apiKey: string,
): Promise<{ items: VideoSummary[]; rejectedIds: string[] }> {
  const uniqueIds = [...new Set(ids)]
  if (!uniqueIds.length) return { items: [], rejectedIds: [] }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos")
  url.searchParams.set("part", "snippet,status,contentDetails")
  url.searchParams.set("id", uniqueIds.join(","))
  url.searchParams.set("key", apiKey)
  const data = await fetchYouTube<YouTubeVideo>(url)
  const refreshedAt = new Date().toISOString()
  const accepted = new Map<string, VideoSummary>()

  for (const video of data.items ?? []) {
    const id = video.id
    const snippet = video.snippet
    const status = video.status
    if (
      !id ||
      !snippet ||
      snippet.categoryId !== "10" ||
      snippet.liveBroadcastContent !== "none" ||
      status?.embeddable !== true ||
      status.privacyStatus !== "public"
    ) {
      continue
    }

    accepted.set(id, {
      id,
      title: decodeEntities(snippet.title?.trim() || "Untitled"),
      channelTitle: decodeEntities(
        snippet.channelTitle?.trim() || "Unknown channel",
      ),
      thumbnailURL: preferredThumbnail(snippet.thumbnails),
      durationSeconds: parseDurationSeconds(video.contentDetails?.duration),
      embeddable: true,
      madeForKids: status.madeForKids === true,
      refreshedAt,
    })
  }

  return {
    items: uniqueIds.flatMap((id) => {
      const item = accepted.get(id)
      return item ? [item] : []
    }),
    rejectedIds: uniqueIds.filter((id) => !accepted.has(id)),
  }
}

export async function searchMusicVideos(
  query: string,
  limit: number,
  apiKey: string,
): Promise<{ items: VideoSummary[]; rejectedIds: string[] }> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search")
  url.searchParams.set("part", "snippet")
  url.searchParams.set("type", "video")
  url.searchParams.set("videoCategoryId", "10")
  url.searchParams.set("videoEmbeddable", "true")
  url.searchParams.set("videoSyndicated", "true")
  url.searchParams.set("safeSearch", "moderate")
  url.searchParams.set("maxResults", String(limit))
  url.searchParams.set("q", query)
  url.searchParams.set("key", apiKey)

  const data = await fetchYouTube<YouTubeSearchItem>(url)
  const ids = (data.items ?? []).flatMap((item) => {
    const id = item.id?.videoId
    return id && item.snippet?.liveBroadcastContent === "none" ? [id] : []
  })
  return fetchVideoSummaries(ids, apiKey)
}
