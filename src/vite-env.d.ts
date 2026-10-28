/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin hosting the /api/* serverless functions, e.g.
   * "https://youtugtog.vercel.app". Required for Capacitor builds, where the
   * WebView origin (https://localhost) has no server behind it. Leave unset
   * for web builds so calls stay same-origin.
   */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
