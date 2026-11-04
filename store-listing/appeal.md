# Play Console appeal — com.youtugtog.app

**Enforcement:** App suspended 30 Oct 2026, Impersonation policy.
**Flagged fields:** Title (en-US), Short description (en-US), Hi-res icon (en-US).

## STATUS: APPEAL DENIED — 31 Oct 2026

Submitted 30 Oct 2026 4:43 PM, denied 31 Oct 2026 10:24 AM (ticket
4-8938000042220). That was the one appeal available for this enforcement, so
**this listing is finished**. `com.youtugtog.app` stays suspended.

Google's reply:

> We've reviewed your appeal request and found that your Youtugtog
> (com.youtugtog.app) app isn't compliant with Google Play policy. [...] your
> app is currently impersonating the brand "YouTube" without proper
> authorization.

They attached `com.youtugtog.app.png` as evidence — it is the **old
play-triangle icon**. The appeal was judged against the listing as it still
stood, which a suspended app cannot change. Describing the rebrand in the
appeal text was never going to be enough; the reviewer looked at the live
listing.

To reinstate this listing they require signed documentation that the app is
authorized to use the YouTube brand — an agreement, authorization letter, or
licensing contract signed by both parties. Screenshots and emails are
explicitly not accepted. That documentation does not exist and will not.

### The route Google gives

> Sign in to your Play Console account and upload a new app using **a new
> package name and a new app name**.

So the Tugtog work is right, but it ships as a **new app**, not an update:

- New package ID (e.g. `ph.tugtog.app`) — `com.youtugtog.app` is burned
- New upload keystore (back it up off the laptop this time)
- New listing, built from `play-console.md`
- On a personal account created after 13 Nov 2023, the 12-tester / 14-day
  closed test applies again

**A suspension is a strike against the developer account.** Google's reply says
repeated violations can terminate it. The next listing has to be clean on the
first try — which is an argument for shortening the "Search YouTube" button
label to "Search", the one prominent YouTube brand use left in the assets.

## Order of operations — appeal FIRST, fix after

The original plan here had it backwards. A suspended app cannot edit its store
listing or upload a build at all: Play Console offers no Main store listing and
no Test and release for it, and those URLs redirect to Home. The only action
available is the appeal.

The appeal form states it plainly: "If you understand what led to this issue and
have a plan for how you will fix it, submit an appeal. If your appeal is
approved, you must fix this issue before you send your app for review."

So the sequence is:

1. Appeal, describing the fix.  ← done
2. If granted, the app is reinstated.
3. Only then update the listing and upload `app-release.aab`
   (versionCode 3 / 1.1.0), with the old bundle under **Not included** — Google's
   removal guidance warns that failing to deactivate it makes resubmission fail.

## Reason selected

"I understand what led to this issue and will fix it" — not "I believe this is
incorrect". The finding is correct and arguing it would be the wrong play.

## Appeal text as submitted (996 / 1000 chars)

The field caps at 1000 characters, so the longer draft below had to be cut.
This is what actually went in:

> We accept the finding and have prepared the fix.
>
> TITLE: renamed "Youtugtog" to "Tugtog". The original was the Filipino word
> tugtog ("to play music"), but we accept that the "You" prefix reads as a
> variant of the YouTube name, which the YouTube API Services Branding
> Guidelines prohibit in an application name. The new name contains no variant
> of YouTube.
>
> ICON: redesigned. The previous silhouette was a play triangle. The new icon is
> a rounded-square tile with an original Philippine-sun and music-note mark, and
> no play-button or store-logo shape.
>
> SHORT DESCRIPTION: rewritten to "Queue songs, follow synced lyrics, and sing
> along. No account needed." It no longer leads with the YouTube brand.
>
> We have also redrawn the feature graphic, removed YouTube keyword stuffing
> from our web metadata, and added a non-affiliation and trademark notice inside
> the app. Playback has always used the official YouTube IFrame Player API. A
> signed build with all of this is ready to upload on reinstatement.

## Longer draft (kept for reference)

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
