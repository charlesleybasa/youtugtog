import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor configuration.
 *
 * `webDir` is the Vite build output. vite.config.ts does not override
 * `build.outDir`, so Vite's default (`dist`) applies — the same directory
 * vercel.json declares as `outputDirectory`. `npx cap sync` copies the
 * contents of that folder into the Android assets bundle, so the folder must
 * already be built before syncing.
 *
 * `androidScheme: 'https'` keeps the WebView origin at `https://localhost`.
 * That matters here for three reasons:
 *   1. The YouTube IFrame player is served over https and refuses to load
 *      inside an insecure (`http://`) origin without mixed-content overrides.
 *   2. `fetch` to the https Vercel API functions from an http origin would be
 *      blocked as mixed content.
 *   3. localStorage — which holds the saved queue and lyrics cache — is keyed
 *      per origin, so the scheme must stay stable across releases or users
 *      silently lose their saved playlists.
 * This is Capacitor's default on Android, but it is pinned explicitly because
 * changing it later would orphan existing users' stored data.
 */
const config: CapacitorConfig = {
  // Permanent once published to the Play Store — change it now if you want a
  // different namespace, not after the first upload.
  appId: 'com.youtugtog.app',
  appName: 'Tugtog',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
