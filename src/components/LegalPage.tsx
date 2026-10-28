type LegalPath = "/privacy" | "/terms" | "/support"

export function isLegalPath(path: string): path is LegalPath {
  return path === "/privacy" || path === "/terms" || path === "/support"
}

function Privacy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Effective August 28, 2026</p>
      <h2>What Tugtog handles</h2>
      <p>
        Tugtog sends the search words and YouTube video IDs you submit to our
        server so it can request music-video information from the YouTube Data
        API. We do not require an account and do not use this information for
        advertising, tracking, or user profiling.
      </p>
      <h2>Information kept on your device</h2>
      <p>
        Your queue, saved playlists, theme, playback preferences, and legal
        consent are stored locally in your browser or app. Tugtog does not
        provide cloud backup or account-based synchronization in this release.
      </p>
      <h2>YouTube and Google</h2>
      <p>
        Tugtog uses YouTube API Services and YouTube’s embedded player. By using
        those features, you also agree to the{" "}
        <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
        Google’s handling of information is described in the{" "}
        <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
      </p>
      <h2>Retention and your choices</h2>
      <p>
        Search requests are processed to return results and may be held briefly
        in shared response caches. You can remove queues and playlists in
        Tugtog or clear local data through your device or browser settings. The
        native widget hides YouTube metadata after 30 days without an app
        refresh; browser queues remain until you remove them or clear storage.
      </p>
      <h2>Children</h2>
      <p>
        Tugtog is not directed to children under 13. Made-for-kids status is
        respected when YouTube identifies a video that way.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy questions can be sent through the contact method listed on our{" "}
        <a href="/support">Support page</a>.
      </p>
    </>
  )
}

function Terms() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p>Effective August 28, 2026</p>
      <p>
        Tugtog helps you search for embeddable music videos, arrange a local
        queue, and play them through YouTube’s official player. Tugtog does not
        host, download, sell, or provide offline copies of YouTube content.
      </p>
      <h2>Your responsibilities</h2>
      <p>
        Use Tugtog lawfully and do not attempt to bypass player controls,
        advertising, access restrictions, rights management, or YouTube’s
        technical protections. Your use of YouTube is also governed by the{" "}
        <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
      </p>
      <h2>Availability</h2>
      <p>
        Search results and playback depend on YouTube, network availability,
        regional rights, API quota, and whether a video remains public and
        embeddable. Features may be unavailable or change without notice.
      </p>
      <h2>Local data</h2>
      <p>
        Queues and playlists are stored on your device. You are responsible for
        maintaining any backup you need. Removing Tugtog or clearing its data
        may permanently remove that local library.
      </p>
      <h2>Warranty and liability</h2>
      <p>
        Tugtog is provided as available without a guarantee that every video or
        service will remain accessible. To the extent allowed by law, Tugtog’s
        publisher is not liable for third-party content or service outages.
      </p>
    </>
  )
}

function Support() {
  return (
    <>
      <h1>Tugtog Support</h1>
      <p>
        Tugtog is a local music queue that plays through YouTube’s visible,
        official embedded player.
      </p>
      <h2>Playback stopped</h2>
      <p>
        Playback intentionally pauses when Tugtog is covered, backgrounded, or
        the device locks. Return to the visible player and press Play. Tugtog
        does not offer background audio or downloads.
      </p>
      <h2>A video will not play</h2>
      <p>
        The video may be private, removed, age-restricted, unavailable in your
        region, live, outside the Music category, or disallowed from embedding.
        Search for another official version.
      </p>
      <h2>Search is unavailable</h2>
      <p>
        Check your connection and try again later. YouTube API quota or an
        upstream outage can temporarily prevent new searches.
      </p>
      <h2>Contact</h2>
      <p>
        Release contact address: <strong>support@tugtog.example</strong>. Replace
        this placeholder with the verified support address before App Store
        submission.
      </p>
    </>
  )
}

export default function LegalPage({ path }: { path: LegalPath }) {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <a className="brand-text font-display text-2xl font-extrabold" href="/">
          Tugtog
        </a>
        <nav aria-label="Legal and support">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </nav>
      </header>
      <article className="neu legal-card">
        {path === "/privacy" ? (
          <Privacy />
        ) : path === "/terms" ? (
          <Terms />
        ) : (
          <Support />
        )}
      </article>
    </main>
  )
}
