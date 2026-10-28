# Tugtog

Tugtog is an iPhone-first music-video queue and playlist app. The repository contains:

- a native SwiftUI app and WidgetKit extension in `ios/`;
- shared queue, metadata, widget-snapshot, and deep-link contracts;
- a React/Vite web companion;
- server-side YouTube Data API endpoints in `api/`;
- App Store metadata, review notes, privacy worksheets, and release checklists in `ios/AppStore/`.

Playback always uses YouTube’s official visible player. Tugtog does not extract audio, download videos, play in the background, or expose lock-screen playback controls. Playback pauses when the app/page is covered, backgrounded, or the phone locks.

## Native iPhone app

Requirements: Xcode 26 with an iOS 26 SDK. The deployment target is iOS 17 and the app is iPhone-only.

1. Open `ios/Tugtog.xcodeproj`.
2. Replace the development placeholders in `ios/TugtogShared/AppConstants.swift`, both entitlements files, and the Xcode build settings:
   - `com.example.tugtog`
   - `com.example.tugtog.widgets`
   - `group.com.example.tugtog`
   - `TEAMID`
   - `tugtog.example.com`
3. Register matching App Group and Associated Domains capabilities in the Apple Developer portal.
4. Select the production Apple Developer Team and run the `Tugtog` scheme on an iPhone.

The widget reads `widget-snapshot-v1.json` from the App Group. It performs no networking and never starts or controls playback.

## Web and video API

Requirements: Node.js 22.12 or newer.

1. Copy `.env.example` to `.env`.
2. Set the server-side key:

   ```env
   YOUTUBE_API_KEY=YOUR_KEY_HERE
   ```

3. Install dependencies and start Vite:

   ```bash
   npm install
   npm run dev
   ```

The browser calls normalized `GET /api/search` and `GET /api/videos` endpoints. The key stays on the server. Search responses are cached for five minutes and details for 24 hours through shared HTTP caching.

## Release preparation

- Replace the placeholder domain, support address, Team ID, bundle identifiers, and copyright owner.
- Publish the generated legal routes and `/.well-known/apple-app-site-association` over HTTPS without redirects.
- Confirm the final App Store name/trademark, YouTube quota, privacy answers, and age rating.
- Validate a signed archive, then complete the physical-iPhone and TestFlight checklist in `ios/AppStore/testflight-checklist.md`.
