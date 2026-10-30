# Play Console submission answers

Everything the Play Console asks for, in the order it asks. Copy-paste ready.
Character limits are Play's, and every field below is already inside them.

---

## 1. Store listing

**App name** (30 max) — 6 chars

    Tugtog

**Short description** (80 max) — 68 chars

    Queue songs, follow synced lyrics, and sing along. No account needed.

**Full description** (4000 max) — ~1,450 chars

    Tugtog is a music player that stays out of your way.

    Search for a song, tap it, and it starts playing. Keep tapping and you build a
    queue — no playlist to create first, no account to make, no setup screen
    between you and the music.

    WHAT IT DOES

    • Search and play millions of songs instantly
    • Build a queue as you go, and reorder or remove tracks any time
    • Shuffle that actually shuffles — every song plays once before any repeats
    • Repeat one track or the whole queue
    • Line-by-line synced lyrics that scroll with the song, when they exist
    • Save a queue as a playlist and load it back later
    • Switch between the player and full video whenever you want to watch
    • Light and dark themes, or follow your system setting
    • On tablets and unfolded foldables, the player and queue sit side by side

    NO ACCOUNT, NO CLUTTER

    There is nothing to sign into. Your queue, saved playlists, and settings live
    on your device and are yours alone — we never upload them, because there is
    nowhere to upload them to. No profile, no listening history, no email asking
    you to come back.

    ABOUT PLAYBACK

    Tugtog works with YouTube. Videos play through YouTube's official embedded
    player, so creators get their views and their ad revenue exactly as they would
    on YouTube itself. Playback pauses when you leave the app, the same as the
    YouTube website. An internet connection is required — nothing is downloaded
    for offline use.

    Tugtog is not affiliated with, endorsed by, or sponsored by YouTube or
    Google LLC. YouTube is a trademark of Google LLC.

**App icon** — `store-listing/icon-512.png` (512×512) ✓
**Feature graphic** — `store-listing/feature-graphic-1024x500.png` (1024×500) ✓
**Phone screenshots** — `screenshots/phone-1-player.png`, `phone-2-dark.png` (1080×2400) ✓
**Tablet / large screen** — `screenshots/foldable-1-twopane.png` (1968×2184) ✓

**App category** — Music & Audio
**Tags** — Music player, Music & audio streaming, Media player (pick up to 5)

**Contact details**
- Email: `charlesleyb24@gmail.com` *(Play publishes this on your store page)*
- Website: `https://youtugtog.vercel.app`
- Phone: leave blank (optional)

**Privacy policy URL** — `https://youtugtog.vercel.app/privacy.html`
Must be live before you submit. Deploy first, then open the URL yourself to confirm.

---

## 2. App content

**App access**
> All functionality is available without special access

No login, no region lock, no promo code. Nothing to explain to reviewers.

**Ads — declare YES, "contains ads"**

Counterintuitive but correct: the embedded YouTube player runs Google's pre-roll and
mid-roll ads inside your app. Play's definition covers any ad shown in the app, not
just ones you sell. Declaring "no ads" and having a reviewer hit a pre-roll is a
policy strike; declaring yes costs you a "Contains ads" badge and nothing else.

**Content rating questionnaire** (category: *Music & Audio* / Reference)

Answer honestly and these are the answers:
- Violence, sexuality, profanity, drugs, gambling *originating in your app* — No to all
- **Does the app let users access user-generated content?** — **Yes.** All of YouTube is
  reachable through search. This is the answer that drives the rating.
- Content moderation — you do not moderate; YouTube does. Say so if there is a free-text box.
- Shares user location / allows user-to-user communication / lets users buy things — No

Expect roughly Teen (ESRB) / PEGI 12 / IARC 12+. Do not try to talk it lower.

**Target audience and content**
- Target age group: **13+** (tick 13-15, 16-17, 18+; leave the under-13 boxes clear)
- Appeals to children: No
- The app does not use Google Play's Families policies

**Data safety** — see section 3 below, it is the long one.

**Everything else** — No / Not applicable:
News app · COVID-19 contact tracing · Government app · Financial features ·
Health apps · Loyalty programs

---

## 3. Data safety form

**Does your app collect or share any of the required user data types?**

**Yes** — one type. It is tempting to answer "no data collected," and Play does exempt
data that is only processed in transit. But your search terms and lyrics lookups pass
through your own Vercel functions, which keep request logs. Declaring it costs you
nothing and matches what the privacy policy says.

Declare exactly one data type:

| Field | Answer |
|---|---|
| Data type | **App activity → Search history** |
| Collected? | Yes |
| Shared with third parties? | Yes — sent to YouTube Data API and LRCLIB to fulfil the request |
| Processed ephemerally? | Yes |
| Required or optional? | Required (the app cannot find songs without it) |
| Purpose | App functionality |
| Linked to the user's identity? | **No** — there are no accounts |
| Used to track the user across apps? | **No** |

**Answer NO to every other data type**, including: name, email, phone, address, location
(precise or approximate), contacts, photos, videos, audio files, files and docs, calendar,
health, financial info, purchase history, and device or other IDs.

**Security practices**
- Data encrypted in transit: **Yes** (everything runs over HTTPS; the WebView origin is
  pinned to `https://` in `capacitor.config.ts`)
- Users can request data deletion: **No mechanism needed** — there is no server-side account
  to delete. If the form forces a choice, pick the option saying users can delete data by
  clearing app storage, and point at the privacy policy.

**Do not declare the queue, saved playlists, or lyrics cache.** They are stored only in
on-device storage and never transmitted, and Play explicitly excludes on-device-only data.

---

## 4. Release

- **Format:** Android App Bundle — `android/app/build/outputs/bundle/release/app-release.aab` (3.4 MB)
- **Release name:** `1.1.0 (3)`
- **Signing:** signed with the upload key; opt in to **Play App Signing** when prompted
- **Countries:** all, unless you want to start narrow

**Release notes** (500 max per language):

    New name, new look.

    Tugtog has a new name and a redesigned app icon. Everything else works
    exactly as before — your saved queues and playlists carry over untouched.

---

## Two things that can stall you

**1. The 12-tester rule.** If your developer account is a *personal* (not organization)
account created after 13 Nov 2023, Google requires a closed test with **at least 12
testers opted in continuously for 14 days** before the Production track unlocks. It is not
a code problem and there is no way around it — start the closed test now so the clock runs
while you finish the listing. Check Play Console → your account type; organization accounts
are exempt.

**2. Keep the upload key alive.** `android/upload-keystore.jks` and
`android/keystore.properties` are gitignored, so they exist on this machine and nowhere
else. Lose them and you cannot ship an update to this listing, ever — you would have to
publish a new app under a new package name. Back both up somewhere off this laptop today.

    Key alias:  upload
    Algorithm:  2048-bit RSA, SHA384withRSA
    Valid:      17 Aug 2026 → 2 Jan 2054

---

## Before every future upload

`versionCode` in `android/app/build.gradle` must be strictly higher than any build Play has
already accepted — including builds it rejected in review. Bump it, then:

    npm run build:capacitor && npx cap sync android
    cd android && ./gradlew clean bundleRelease
