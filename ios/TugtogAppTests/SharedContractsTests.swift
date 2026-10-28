import Foundation
import SwiftData
import Testing
@testable import TugtogApp

struct SharedContractsTests {
    @Test("YouTube URLs and direct IDs normalize to the canonical video ID")
    func parsesYouTubeVideoIDs() {
        let videoID = "dQw4w9WgXcQ"

        #expect(YouTubeVideoID.parse(videoID) == videoID)
        #expect(YouTubeVideoID.parse("https://youtu.be/\(videoID)") == videoID)
        #expect(YouTubeVideoID.parse("https://www.youtube.com/watch?v=\(videoID)") == videoID)
        #expect(YouTubeVideoID.parse("https://example.com/watch?v=\(videoID)") == nil)
    }

    @Test("Universal and custom links resolve to the same player destination")
    func parsesPlayerDeepLinks() throws {
        let videoID = "dQw4w9WgXcQ"
        let universalURL = try #require(
            URL(string: "https://\(AppConstants.universalLinkHost)/open/player/\(videoID)")
        )
        let customURL = try #require(URL(string: "tugtog://open/player/\(videoID)"))

        #expect(DeepLinkParser.parse(universalURL) == .player(videoID: videoID))
        #expect(DeepLinkParser.parse(customURL) == .player(videoID: videoID))
    }

    @Test("Widget snapshots cap the queue preview and round-trip atomically")
    func widgetSnapshotRoundTrip() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let tracks = (0..<5).map { index in
            WidgetTrack(
                videoID: String(format: "videoID%04d", index),
                title: "Track \(index)",
                channelTitle: "Channel \(index)"
            )
        }
        let snapshot = WidgetSnapshot(
            generatedAt: now,
            metadataExpiresAt: now.addingTimeInterval(AppConstants.metadataLifetime),
            consentVersion: AppConstants.currentConsentVersion,
            selectedVideoID: tracks[0].videoID,
            queueIndex: 0,
            queueCount: tracks.count,
            upNext: tracks
        )
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tugtog-widget-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: fileURL) }

        try WidgetSnapshotStore.write(snapshot, to: fileURL)
        let storedSnapshot = try WidgetSnapshotStore.read(from: fileURL)
        let decoded = try #require(storedSnapshot)

        #expect(decoded == snapshot)
        #expect(decoded.upNext.count == 3)
    }

    @Test("Expired or unaccepted snapshots are hidden from widgets")
    func sanitizesPrivateWidgetMetadata() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let track = WidgetTrack(
            videoID: "dQw4w9WgXcQ",
            title: "Private title",
            channelTitle: "Private channel"
        )

        let expired = WidgetSnapshot(
            generatedAt: now.addingTimeInterval(-100),
            metadataExpiresAt: now.addingTimeInterval(-1),
            consentVersion: AppConstants.currentConsentVersion,
            selectedVideoID: track.videoID,
            queueIndex: 0,
            queueCount: 1,
            upNext: [track]
        )
        let oldConsent = WidgetSnapshot(
            generatedAt: now,
            metadataExpiresAt: now.addingTimeInterval(100),
            consentVersion: AppConstants.currentConsentVersion - 1,
            selectedVideoID: track.videoID,
            queueIndex: 0,
            queueCount: 1,
            upNext: [track]
        )

        #expect(expired.sanitizedForDisplay(now: now) == nil)
        #expect(oldConsent.sanitizedForDisplay(now: now) == nil)
    }

    @Test("Deep links validate destinations and optional queue focus IDs")
    func rejectsMalformedDeepLinks() throws {
        let videoID = "dQw4w9WgXcQ"
        let queueURL = try #require(
            URL(string: "https://\(AppConstants.universalLinkHost)/open/queue?focus=\(videoID)")
        )
        let invalidHost = try #require(URL(string: "https://example.com/open/search"))
        let invalidVideo = try #require(
            URL(string: "tugtog://open/player/short")
        )

        #expect(DeepLinkParser.parse(queueURL) == .queue(focusVideoID: videoID))
        #expect(DeepLinkParser.parse(invalidHost) == nil)
        #expect(DeepLinkParser.parse(invalidVideo) == nil)
    }

    @Test("API summaries decode normalized dates and duration metadata")
    func decodesVideoAPIContract() throws {
        let json = Data(
            #"{"items":[{"id":"dQw4w9WgXcQ","title":"A title","channelTitle":"A channel","thumbnailURL":"https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg","durationSeconds":213,"embeddable":true,"madeForKids":false,"refreshedAt":"2026-08-28T12:00:00Z"}],"rejectedIds":["M7lc1UVf-VE"]}"#.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let response = try decoder.decode(VideoItemsResponse.self, from: json)

        #expect(response.items.count == 1)
        #expect(response.items[0].durationSeconds == 213)
        #expect(response.items[0].embeddable)
        #expect(response.rejectedIds == ["M7lc1UVf-VE"])
        #expect(ISO8601Duration.seconds(from: "PT1H2M3S") == 3_723)
        #expect(PlaybackTimeFormatter.string(seconds: 3_723) == "1:02:03")
    }

    @Test("SwiftData preserves unique queue order and immutable playlist snapshots")
    @MainActor
    func persistsQueueAndPlaylistSnapshots() throws {
        let schema = Schema([
            StoredVideo.self,
            QueueItem.self,
            SavedPlaylist.self,
            SavedPlaylistItem.self,
        ])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: schema, configurations: configuration)
        let repository = LibraryRepository(context: ModelContext(container))
        let first = makeVideo(id: "dQw4w9WgXcQ", title: "First")
        let second = makeVideo(id: "M7lc1UVf-VE", title: "Second")

        try repository.replaceQueue(with: [second, first, second])
        #expect(try repository.loadQueue().map(\.id) == [second.id, first.id])

        let snapshot = try repository.savePlaylist(name: "Road trip", videos: [second, first])
        try repository.replaceQueue(with: [first])
        let playlists = try repository.loadPlaylists()
        #expect(playlists.first?.videos.map(\.id) == snapshot.videos.map(\.id))

        try repository.deletePlaylist(id: snapshot.id)
        #expect(try repository.loadPlaylists().isEmpty)
        try repository.restorePlaylist(snapshot)
        #expect(try repository.loadPlaylists().first?.name == "Road trip")
    }

    private func makeVideo(id: String, title: String) -> VideoSummary {
        VideoSummary(
            id: id,
            title: title,
            channelTitle: "Test Channel",
            thumbnailURL: URL(string: "https://i.ytimg.com/vi/\(id)/mqdefault.jpg")!,
            durationSeconds: 180,
            embeddable: true,
            madeForKids: false,
            refreshedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }
}
