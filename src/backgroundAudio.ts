import { Capacitor, registerPlugin } from "@capacitor/core"

/* ---- background playback (Android only) ------------------------------ *
 * The native side keeps the WebView from being told it is hidden, which is
 * what otherwise makes the YouTube iframe pause on screen lock. That alone
 * is not enough: a backgrounded process can still be frozen or killed, so a
 * foreground service is held for as long as something is playing.
 *
 * The service is deliberately tied to playback rather than to the app being
 * open, so a paused app is not holding a foreground service — Android
 * penalises that, and there would be an ongoing notification with nothing
 * behind it.
 *
 * On the web every call is a no-op: there is no service to run, and page
 * visibility rules there are the browser's to enforce.
 * --------------------------------------------------------------------- */

interface BackgroundAudioPlugin {
  start(): Promise<void>
  stop(): Promise<void>
}

const plugin = registerPlugin<BackgroundAudioPlugin>("BackgroundAudio")

const isNative = Capacitor.isNativePlatform()

/** Hold a foreground service so audio survives backgrounding. */
export async function startBackgroundAudio(): Promise<void> {
  if (!isNative) return
  try {
    await plugin.start()
  } catch {
    /* Service refused to start (e.g. notification permission revoked mid-run).
       Playback in the foreground is unaffected, so this is not worth surfacing. */
  }
}

/** Release the foreground service and its notification. */
export async function stopBackgroundAudio(): Promise<void> {
  if (!isNative) return
  try {
    await plugin.stop()
  } catch {
    /* Already stopped. */
  }
}
