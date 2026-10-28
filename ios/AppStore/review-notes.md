# App Review Notes

## Product summary

Tugtog is a native SwiftUI queue and local-playlist organizer for music videos played through the official YouTube embedded player. The app adds native queue management, saved immutable playlist snapshots, drag reordering, swipe deletion with undo, device-local persistence, theme controls, universal links, and Home/Lock Screen Up Next widgets.

## Playback behavior

- Tugtog uses a visible YouTube IFrame Player inside `WKWebView`.
- The player retains official controls, branding, advertising behavior, and video presentation.
- Tugtog does not download, cache, extract, isolate, or re-host YouTube audio or video.
- Playback pauses whenever Tugtog becomes inactive, enters the background, the iPhone locks, or a sheet covers the player.
- There is no Background Audio capability, lock-screen transport, Live Activity, or hidden mini-player.
- Widget taps deep-link into the visible player; widgets cannot start or control playback.

## Test flow

1. Launch Tugtog and accept the Privacy Policy and Terms of Use.
2. Tap Search in the top toolbar.
3. Search for an available music video and tap Add.
4. Dismiss Search and tap the queued row to cue it in the visible player.
5. Use the official player control to begin playback.
6. Reorder the queue, swipe to delete, and use Undo.
7. Open Library, save the queue, then test append and replace.
8. Lock the iPhone or background the app; playback pauses.
9. Add the Tugtog Up Next widget; tapping it returns to the corresponding app destination without autoplay.

## External services

- YouTube Data API v3 provides search and video metadata.
- YouTube IFrame Player API provides playback.
- No account is created and no analytics or advertising SDK is included.
- Queue and playlist state remains on the device.

## Reviewer configuration

- No login is required.
- A functioning production API endpoint and sufficient YouTube API quota are required.
- If search quota is temporarily unavailable, reviewers can paste a supported YouTube video URL using the queue's Paste action.

