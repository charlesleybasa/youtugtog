# App Privacy Working Sheet

This file is a release checklist, not legal advice. Reconcile it with the final binary, server logs, privacy policy, and App Store Connect questionnaire immediately before upload.

## Planned data flow

- Search text is sent to Tugtog's serverless API and then to YouTube for app functionality.
- Raw search text is not intentionally stored or logged by Tugtog.
- Queue, playlist, theme, consent, and widget snapshot data remains on the device.
- No accounts, analytics, advertising identifiers, tracking, contacts, location, health, payment, or diagnostic collection is implemented.
- The widget performs no network requests.

## App Store Connect working declaration

- **Search History:** Collected for App Functionality; not linked to identity; not used for tracking. Confirm against Apple's current definition and the production hosting/logging configuration.
- **Tracking:** No.
- **Data linked to the user:** No planned categories.

## Privacy manifest checks

- Include `PrivacyInfo.xcprivacy` in every executable target that uses a required-reason API.
- App-only `UserDefaults` usage uses approved reason `CA92.1` when applicable.
- If App Group `UserDefaults` is introduced, use approved reason `1C8F.1` in each bundle that accesses it.
- Do not declare tracking domains.
- Run Xcode's privacy report and inspect the archived app before upload.

