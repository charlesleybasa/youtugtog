import type { APIRequest, APIResponse } from "./_http.ts"
import {
  createSession,
  endSession,
  enqueueSessionCommand,
  getSessionState,
  isValidSessionCode,
  joinSession,
  leaveSession,
  normalizeSessionCode,
  syncSession,
  type SessionCommand,
  type SessionSnapshot,
} from "./_session.ts"

type ErrorCode = "invalid_request" | "method_not_allowed" | "session_not_found"

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function fail(res: APIResponse, status: number, code: ErrorCode, message: string) {
  return res.status(status).json({
    error: { code, message },
  })
}

export default async function handler(req: APIRequest, res: APIResponse) {
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "GET") {
    const rawCode = first(req.query.code) ?? ""
    const code = normalizeSessionCode(rawCode)
    if (!isValidSessionCode(code)) {
      return fail(
        res,
        400,
        "invalid_request",
        "Enter a valid 6-character session code.",
      )
    }

    const role = first(req.query.role)
    const clientId = first(req.query.clientId)
    const state = getSessionState(code, role, clientId)
    if (!state) {
      return fail(
        res,
        404,
        "session_not_found",
        "No active session found for that code.",
      )
    }

    return res.status(200).json(state)
  }

  if (req.method === "POST") {
    let parsedBody: unknown = req.body
    if (typeof parsedBody === "string" && parsedBody.trim()) {
      try {
        parsedBody = JSON.parse(parsedBody)
      } catch {
        return fail(res, 400, "invalid_request", "Invalid JSON body.")
      }
    }
    const body =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as Record<string, unknown>)
        : null

    if (!body || typeof body.action !== "string") {
      return fail(res, 400, "invalid_request", "Missing session action.")
    }

    const action = body.action

    if (action === "create") {
      const hostId = typeof body.hostId === "string" ? body.hostId.trim() : ""
      const snapshot = body.snapshot as SessionSnapshot | undefined
      const requestedCode =
        typeof body.code === "string" ? body.code : undefined

      if (!hostId || !snapshot || typeof snapshot !== "object") {
        return fail(
          res,
          400,
          "invalid_request",
          "Host ID and initial snapshot are required.",
        )
      }

      const created = createSession(hostId, snapshot, requestedCode)
      return res.status(200).json(created)
    }

    if (action === "join") {
      const rawCode = typeof body.code === "string" ? body.code : ""
      const code = normalizeSessionCode(rawCode)
      if (!isValidSessionCode(code)) {
        return fail(
          res,
          400,
          "invalid_request",
          "Enter a valid 6-character session code.",
        )
      }
      const clientId =
        typeof body.clientId === "string" ? body.clientId.trim() : ""
      const joined = joinSession(code, clientId)
      if (!joined) {
        return fail(
          res,
          404,
          "session_not_found",
          "No active session found for that code.",
        )
      }
      return res.status(200).json(joined)
    }

    if (action === "sync") {
      const rawCode = typeof body.code === "string" ? body.code : ""
      const hostId = typeof body.hostId === "string" ? body.hostId.trim() : ""
      const snapshot = body.snapshot as SessionSnapshot | undefined
      const ackCommandIds = Array.isArray(body.ackCommandIds)
        ? body.ackCommandIds.filter((id): id is string => typeof id === "string")
        : undefined

      if (!rawCode || !hostId || !snapshot || typeof snapshot !== "object") {
        return fail(
          res,
          400,
          "invalid_request",
          "Session code, hostId, and snapshot are required.",
        )
      }

      const synced = syncSession(rawCode, hostId, snapshot, ackCommandIds)
      if (!synced) {
        return fail(
          res,
          400,
          "invalid_request",
          "Invalid session code.",
        )
      }
      return res.status(200).json(synced)
    }

    if (action === "command") {
      const rawCode = typeof body.code === "string" ? body.code : ""
      const clientId =
        typeof body.clientId === "string" ? body.clientId.trim() : ""
      const command = body.command as SessionCommand | undefined

      if (
        !rawCode ||
        !command ||
        typeof command !== "object" ||
        typeof command.id !== "string" ||
        !command.payload ||
        typeof command.payload.type !== "string"
      ) {
        return fail(
          res,
          400,
          "invalid_request",
          "Valid session code and command payload are required.",
        )
      }

      const result = enqueueSessionCommand(rawCode, clientId, command)
      if (!result) {
        return fail(
          res,
          404,
          "session_not_found",
          "That session is no longer active.",
        )
      }
      return res.status(200).json(result)
    }

    if (action === "leave") {
      const rawCode = typeof body.code === "string" ? body.code : ""
      const clientId =
        typeof body.clientId === "string" ? body.clientId.trim() : ""
      const result = leaveSession(rawCode, clientId)
      return res.status(200).json(result)
    }

    if (action === "end") {
      const rawCode = typeof body.code === "string" ? body.code : ""
      const hostId = typeof body.hostId === "string" ? body.hostId.trim() : ""
      const result = endSession(rawCode, hostId)
      return res.status(200).json(result)
    }

    return fail(res, 400, "invalid_request", "Unsupported session action.")
  }

  res.setHeader("Allow", "GET, POST")
  return fail(
    res,
    405,
    "method_not_allowed",
    "Only GET and POST requests are supported.",
  )
}
