export type APIRequest = {
  method?: string
  query: Record<string, string | string[] | undefined>
  body?: unknown
}

export type APIResponse = {
  setHeader(name: string, value: string): void
  status(code: number): APIResponse
  json(body: unknown): unknown
}
