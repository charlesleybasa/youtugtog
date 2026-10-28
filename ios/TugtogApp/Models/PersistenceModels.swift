import Foundation
import SwiftData

@Model
final class StoredVideo {
    @Attribute(.unique) var videoID: String
    var title: String
    var channelTitle: String
    var thumbnailURLString: String
    var durationSeconds: Int
    var embeddable: Bool
    var madeForKids: Bool
    var refreshedAt: Date

    init(video: VideoSummary) {
        videoID = video.id
        title = video.title
        channelTitle = video.channelTitle
        thumbnailURLString = video.thumbnailURL.absoluteString
        durationSeconds = video.durationSeconds
        embeddable = video.embeddable
        madeForKids = video.madeForKids
        refreshedAt = video.refreshedAt
    }

    func update(from video: VideoSummary) {
        title = video.title
        channelTitle = video.channelTitle
        thumbnailURLString = video.thumbnailURL.absoluteString
        durationSeconds = video.durationSeconds
        embeddable = video.embeddable
        madeForKids = video.madeForKids
        refreshedAt = video.refreshedAt
    }

    var videoSummary: VideoSummary? {
        guard let thumbnailURL = URL(string: thumbnailURLString) else { return nil }
        return VideoSummary(
            id: videoID,
            title: title,
            channelTitle: channelTitle,
            thumbnailURL: thumbnailURL,
            durationSeconds: durationSeconds,
            embeddable: embeddable,
            madeForKids: madeForKids,
            refreshedAt: refreshedAt
        )
    }
}

@Model
final class QueueItem {
    @Attribute(.unique) var id: UUID
    var videoID: String
    var position: Int

    init(id: UUID = UUID(), videoID: String, position: Int) {
        self.id = id
        self.videoID = videoID
        self.position = position
    }
}

@Model
final class SavedPlaylist {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date

    init(id: UUID = UUID(), name: String, createdAt: Date = .now) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
    }
}

@Model
final class SavedPlaylistItem {
    @Attribute(.unique) var id: UUID
    var playlistID: UUID
    var videoID: String
    var position: Int

    init(
        id: UUID = UUID(),
        playlistID: UUID,
        videoID: String,
        position: Int
    ) {
        self.id = id
        self.playlistID = playlistID
        self.videoID = videoID
        self.position = position
    }
}

struct SavedPlaylistData: Identifiable, Hashable, Sendable {
    let id: UUID
    let name: String
    let createdAt: Date
    let videos: [VideoSummary]
}
