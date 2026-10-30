# Play Console appeal — com.youtugtog.app

**Enforcement:** App suspended 30 Oct 2026, Impersonation policy.
**Flagged fields:** Title (en-US), Short description (en-US), Hi-res icon (en-US).

> **You get ONE appeal per enforcement action.** Do not file until the listing has
> been updated, the new AAB (versionCode 3) is uploaded, and the non-compliant
> bundle is moved to "Not included". Google's removal guidance warns that failing
> to deactivate the old bundle makes the resubmission fail.

## Order of operations

1. Update the store listing — name, short description, full description, icon,
   feature graphic, screenshots (all from `play-console.md`).
2. Create a release with `app-release.aab` (versionCode 3 / versionName 1.1.0).
   Put the old bundle under **Not included**.
3. Only then: Policy status → **Appeal**.

## Appeal text (copy-paste)

Our app was suspended under the Impersonation policy for its title, icon, and
short description. We agree with the finding and have removed the resemblance
rather than contest it.

TITLE — renamed from "Youtugtog" to "Tugtog". The original name was intended as
the Filipino word tugtog ("to play music"), but we accept that the "You" prefix
reads as a variant of the YouTube name, which the YouTube API Services Branding
Guidelines prohibit in an application name. The new name contains no
abbreviation or variant of YouTube.

ICON — redesigned. The previous icon's silhouette was a play triangle. The new
icon is a rounded-square tile carrying an original Philippine-sun and
music-note mark, with no play-button or store-logo shape.

SHORT DESCRIPTION — rewritten to "Queue songs, follow synced lyrics, and sing
along. No account needed." It no longer leads with the YouTube brand.

We have also redrawn the feature graphic, removed YouTube keyword stuffing from
our web metadata, and added a non-affiliation and trademark notice inside the
app itself. Playback has always run through the official YouTube IFrame Player
API — we extract, download, and re-host nothing.

## Notes

- Appeals are answered in Chinese, English, Japanese, or Korean only.
- There is no published SLA. Google states nearly all successful appeals resolve
  within 6 months; most metadata appeals come back far sooner.
- The package ID `com.youtugtog.app` cannot be changed on an existing listing and
  still carries the old name in the Play URL. It was not among the cited fields.
  If the appeal is denied on that basis, the fallback is a fresh listing under a
  new package — which means a new keystore and, on a personal developer account,
  redoing the 12-tester / 14-day closed test.
