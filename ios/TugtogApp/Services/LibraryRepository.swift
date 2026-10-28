import Foundation
import SwiftData

@MainActor
final class LibraryRepository {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    func loadQueue() throws -> [VideoSummary] {
        let queueItems = try context.fetch(
            FetchDescriptor<QueueItem>(sortBy: [SortDescriptor(\QueueItem.position)])
        )
        let videos = try storedVideoLookup()
        return queueItems.compactMap { videos[$0.videoID]?.videoSummary }
    }

    func replaceQueue(with videos: [VideoSummary]) throws {
        var seenVideoIDs = Set<String>()
        let uniqueVideos = videos.filter { seenVideoIDs.insert($0.id).inserted }
        let existingItems = try context.fetch(FetchDescriptor<QueueItem>())
        existingItems.forEach(context.delete)

        for (position, video) in uniqueVideos.enumerated() {
            try upsert(video)
            context.insert(QueueItem(videoID: video.id, position: position))
        }
        try context.save()
    }

    func storeVideos(_ videos: [VideoSummary]) throws {
        for video in videos {
            try upsert(video)
        }
        try context.save()
    }

    func loadPlaylists() throws -> [SavedPlaylistData] {
        let playlists = try context.fetch(
            FetchDescriptor<SavedPlaylist>(
                sortBy: [SortDescriptor(\SavedPlaylist.createdAt, order: .reverse)]
            )
        )
        let items = try context.fetch(
            FetchDescriptor<SavedPlaylistItem>(
                sortBy: [SortDescriptor(\SavedPlaylistItem.position)]
            )
        )
        let videos = try storedVideoLookup()
        let itemsByPlaylist = Dictionary(grouping: items, by: \SavedPlaylistItem.playlistID)

        return playlists.map { playlist in
            let playlistVideos = (itemsByPlaylist[playlist.id] ?? []).compactMap {
                videos[$0.videoID]?.videoSummary
            }
            return SavedPlaylistData(
                id: playlist.id,
                name: playlist.name,
                createdAt: playlist.createdAt,
                videos: playlistVideos
            )
        }
    }

    @discardableResult
    func savePlaylist(name: String, videos: [VideoSummary]) throws -> SavedPlaylistData {
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let playlist = SavedPlaylist(name: normalizedName)
        context.insert(playlist)

        for (position, video) in videos.enumerated() {
            try upsert(video)
            context.insert(
                SavedPlaylistItem(
                    playlistID: playlist.id,
                    videoID: video.id,
                    position: position
                )
            )
        }
        try context.save()

        return SavedPlaylistData(
            id: playlist.id,
            name: playlist.name,
            createdAt: playlist.createdAt,
            videos: videos
        )
    }

    func restorePlaylist(_ playlist: SavedPlaylistData) throws {
        let storedPlaylist = SavedPlaylist(
            id: playlist.id,
            name: playlist.name,
            createdAt: playlist.createdAt
        )
        context.insert(storedPlaylist)

        for (position, video) in playlist.videos.enumerated() {
            try upsert(video)
            context.insert(
                SavedPlaylistItem(
                    playlistID: playlist.id,
                    videoID: video.id,
                    position: position
                )
            )
        }
        try context.save()
    }

    func deletePlaylist(id: UUID) throws {
        let playlistID = id
        let playlistDescriptor = FetchDescriptor<SavedPlaylist>(
            predicate: #Predicate { $0.id == playlistID }
        )
        let itemDescriptor = FetchDescriptor<SavedPlaylistItem>(
            predicate: #Predicate { $0.playlistID == playlistID }
        )
        try context.fetch(playlistDescriptor).forEach(context.delete)
        try context.fetch(itemDescriptor).forEach(context.delete)
        try context.save()
    }

    func clearAll() throws {
        try context.delete(model: QueueItem.self)
        try context.delete(model: SavedPlaylistItem.self)
        try context.delete(model: SavedPlaylist.self)
        try context.delete(model: StoredVideo.self)
        try context.save()
    }

    private func storedVideoLookup() throws -> [String: StoredVideo] {
        Dictionary(
            uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredVideo>()).map {
                ($0.videoID, $0)
            }
        )
    }

    private func upsert(_ video: VideoSummary) throws {
        let videoID = video.id
        let descriptor = FetchDescriptor<StoredVideo>(
            predicate: #Predicate { $0.videoID == videoID }
        )
        if let stored = try context.fetch(descriptor).first {
            stored.update(from: video)
        } else {
            context.insert(StoredVideo(video: video))
        }
    }
}
