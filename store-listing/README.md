# Play Store listing assets

Generated from the app itself — screenshots are real emulator captures, not mockups.

| File | Play field | Size |
|---|---|---|
| `icon-512.png` | App icon | 512×512 |
| `feature-graphic-1024x500.png` | Feature graphic | 1024×500 |
| `screenshots/phone-1-player.png` | Phone screenshot | 1080×2400 |
| `screenshots/phone-2-dark.png` | Phone screenshot | 1080×2400 |
| `screenshots/foldable-1-twopane.png` | Tablet / large screen | 1968×2184 |

Play requires the icon, the feature graphic, and at least 2 phone screenshots.
The large-screen shot is optional but Play grades large-screen quality
separately and surfaces it to foldable and tablet users, so it is worth
including given the app has a real two-pane layout.

## Regenerating the icon and feature graphic

Both are drawn from code so the mark stays reproducible. Run from the repo root:

    python3 assets/make-icon.py             # masters -> assets/icon*.png
    python3 assets/make-derived.py          # launcher mipmaps, splashes, web icons, icon-512
    python3 assets/make-feature-graphic.py  # feature-graphic-1024x500.png

`make-icon.py` holds the geometry: a Philippine sun and music note on a rounded
tile. It is deliberately not a play triangle — the previous mark was, and Google
Play cited it under the Impersonation policy, since a play triangle reads as both
the YouTube and the Google Play logo. The feature graphic sets the wordmark in a
single continuous gradient for the same reason; the old one split it into "You"
in orange and "tugtog" in pink, echoing YouTube's own lockup.

The wordmark renders in Avenir Next Heavy (a system font). The app itself uses
Plus Jakarta Sans ExtraBold from Google Fonts; if you want the graphic to match
exactly, drop the TTF next to these scripts and point `FONT` at it.

## Regenerating screenshots

With an emulator running and the app installed:

    adb shell am start -n com.youtugtog.app/.MainActivity
    adb exec-out screencap -p > store-listing/screenshots/phone-1-player.png

Playback must be running before you capture — autoplay is blocked, so tap the
play button first and give it a few seconds, or the player sits at 0:00 / --:--
and looks broken. Known issue: do NOT capture the queue panel on Android. In
WebView 155 the queue sheet renders horizontally offset, clipping "Your queue"
and pushing "Save queue" past the right edge. The same markup is correct in a
desktop browser at the same CSS width, so it is a WebView bug, not a layout
bug. The queue is shown in the large-screen shot instead, where it renders
correctly.

For the large-screen shot, override the display first and reset it after:

    adb shell wm size 1968x2184 && adb shell wm density 420
    adb exec-out screencap -p > store-listing/screenshots/foldable-1-twopane.png
    adb shell wm size reset && adb shell wm density reset
