import type { APIRequest, APIResponse } from "./_http.ts"
import {
  fetchVideoSummaries,
  isVideoId,
  YouTubeUpstreamError,
} from "./_youtube.ts"

type ErrorCode =
  | "invalid_request"
  | "method_not_allowed"
  | "service_unconfigured"
  | "quota_exceeded"
  | "upstream_unavailable"

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function fail(
  res: APIResponse,
  status: number,
  code: ErrorCode,
  message: string,
  retryAfterSeconds?: number,
) {
  if (retryAfterSeconds) res.setHeader("Retry-After", String(retryAfterSeconds))
  return res.status(status).json({
    error: {
      code,
      message,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
  })
}

export default async function handler(req: APIRequest, res: APIResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET")
    return fail(res, 405, "method_not_allowed", "Only GET requests are supported.")
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return fail(
      res,
      500,
      "service_unconfigured",
      "Video details are not configured yet.",
    )
  }

  const rawIds = first(req.query.ids) ?? ""
  const ids = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (!ids.length || ids.length > 50 || ids.some((id) => !isVideoId(id))) {
    return fail(
      res,
      400,
      "invalid_request",
      "Provide between 1 and 50 comma-separated YouTube video IDs.",
    )
  }

  try {
    const result = await fetchVideoSummaries(ids, apiKey)
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600",
    )
    return res.status(200).json(result)
  } catch (error) {
    if (error instanceof YouTubeUpstreamError) {
      const quota = /quota/i.test(error.reason ?? "") || error.status === 429
      if (quota) {
        return fail(
          res,
          429,
          "quota_exceeded",
          "Video details are temporarily busy. Please try again later.",
          300,
        )
      }
    }
    return fail(
      res,
      502,
      "upstream_unavailable",
      "Video details are temporarily unavailable.",
    )
  }
}
