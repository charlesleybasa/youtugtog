# Play Store listing assets

Generated from the app itself — screenshots are real emulator captures, not mockups.

| File | Play field | Size |
|---|---|---|
| `icon-512.png` | App icon | 512×512 |
| `feature-graphic-1024x500.png` | Feature graphic | 1024×500 |
| `screenshots/phone-1-player.png` | Phone screenshot | 1080×2400 |
| `screenshots/phone-2-queue.png` | Phone screenshot | 1080×2400 |
| `screenshots/foldable-1-twopane.png` | Tablet / large screen | 1968×2184 |

Play requires the icon, the feature graphic, and at least 2 phone screenshots.
The large-screen shot is optional but Play grades large-screen quality
separately and surfaces it to foldable and tablet users, so it is worth
including given the app has a real two-pane layout.

## Regenerating screenshots

With an emulator running and the app installed:

    adb shell am start -n com.youtugtog.app/.MainActivity
    adb exec-out screencap -p > store-listing/screenshots/phone-1-player.png

For the large-screen shot, override the display first and reset it after:

    adb shell wm size 1968x2184 && adb shell wm density 420
    adb exec-out screencap -p > store-listing/screenshots/foldable-1-twopane.png
    adb shell wm size reset && adb shell wm density reset
