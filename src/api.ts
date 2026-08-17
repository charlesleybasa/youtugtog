/* ---- API endpoint resolution ---------------------------------------- *
 * On the web the app is served from the same origin as its serverless
 * functions, so "/api/search" resolves to the deployed function and a
 * relative path is all that is needed.
 *
 * Inside Capacitor the bundle is served by the WebView's own local server
 * (https://localhost with androidScheme: 'https'), and there is no server
 * behind it — a relative "/api/search" would resolve to
 * https://localhost/api/search and 404 against the bundled assets. Native
 * builds therefore need an absolute base pointing at the deployed API.
 *
 * VITE_API_BASE_URL supplies that base. It is inlined at build time, so it
 * must be set for the build that gets synced into Android. Left unset, the
 * app falls back to the current origin, which is exactly the existing web
 * behaviour — so the web build is unaffected.
 * --------------------------------------------------------------------- */

const CONFIGURED_BASE = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "")

/** Absolute base for /api/* calls, or "" when same-origin (web). */
export const API_BASE_URL = CONFIGURED_BASE ?? ""

/**
 * Resolve an /api/* path to a fully-qualified URL.
 *
 * Returns an absolute URL in both modes rather than a relative path, because
 * the lyrics caller feeds the result into `new URL()` to append query params.
 */
export function apiUrl(path: string): string {
  return new URL(path, API_BASE_URL || window.location.origin).toString()
}
