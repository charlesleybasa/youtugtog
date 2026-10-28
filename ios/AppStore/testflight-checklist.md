# TestFlight and Release Checklist

## Signing and configuration

- [ ] Replace `com.example.tugtog` and related widget/App Group placeholders.
- [ ] Select the production Apple Developer Team.
- [ ] Register the App Group and Associated Domains capabilities.
- [ ] Set the production HTTPS API and universal-link domain.
- [ ] Confirm the Music category, age-rating answers, copyright, and availability.
- [ ] Confirm `YOUTUBE_API_KEY` and quota in the production environment.

## Functional acceptance

- [ ] Consent gate works on clean install and legal links always remain available.
- [ ] Empty queue, search, paste, add, cue, play, pause, next, previous, shuffle, repeat, and seek work.
- [ ] Playback pauses for app background, screen lock, inactive scene, and covering sheets.
- [ ] Queue filter, reorder, delete, and Undo persist correctly.
- [ ] Library save, append, replace, delete, and Undo persist correctly.
- [ ] Deep links handle valid, invalid, missing, and unavailable IDs safely without autoplay.
- [ ] Search handles offline, quota, malformed, empty, and upstream-error states.
- [ ] Widget handles populated, empty, stale, redacted, and deleted-content states.

## Device and accessibility

- [ ] Test on the smallest supported iPhone, a standard iPhone, and a Max-size iPhone.
- [ ] Test VoiceOver, Dynamic Type through accessibility sizes, Reduce Motion, Increase Contrast, and Bold Text.
- [ ] Test Light, Dark, and System appearance.
- [ ] Test Lock Screen, Always On display where available, StandBy, cold launch, and suspended-app widget links.
- [ ] Test poor connectivity and recovery on a physical iPhone.

## Compliance and packaging

- [ ] Confirm no Background Audio, downloads, hidden playback, analytics, ads, or tracking capabilities are present.
- [ ] Verify YouTube controls, branding, ads, links, and video remain unobscured and unmodified.
- [ ] Verify Privacy Policy, Terms, Support, Google Privacy, and YouTube Terms links.
- [ ] Inspect Xcode privacy report and validate all privacy manifests.
- [ ] Validate the archive, run static analysis, and resolve every warning that affects behavior or submission.
- [ ] Complete internal TestFlight testing before external review or App Store submission.
