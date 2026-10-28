import type { APIRequest, APIResponse } from "./_http.ts"
import { searchMusicVideos, YouTubeUpstreamError } from "./_youtube.ts"

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
      "Video search is not configured yet.",
    )
  }

  const query = first(req.query.q)?.trim().replace(/\s+/g, " ") ?? ""
  if (query.length < 2 || query.length > 100) {
    return fail(
      res,
      400,
      "invalid_request",
      "Search terms must contain between 2 and 100 characters.",
    )
  }

  const rawLimit = Number(first(req.query.limit) ?? "8")
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 8) {
    return fail(
      res,
      400,
      "invalid_request",
      "The result limit must be a whole number between 1 and 8.",
    )
  }

  try {
    const result = await searchMusicVideos(query, rawLimit, apiKey)
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
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
          "Search is temporarily busy. Please try again later.",
          300,
        )
      }
    }
    return fail(
      res,
      502,
      "upstream_unavailable",
      "YouTube search is temporarily unavailable.",
    )
  }
}
