import Foundation
import Observation
import SwiftData
import SwiftUI
import UIKit
#if canImport(WidgetKit)
import WidgetKit
#endif

enum ThemePreference: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    var id: Self { self }

    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

enum RepeatMode: String, CaseIterable, Sendable {
    case off
    case all
    case one

    var label: String {
        switch self {
        case .off: "Repeat off"
        case .all: "Repeat all"
        case .one: "Repeat one"
        }
    }

    var symbolName: String {
        self == .one ? "repeat.1" : "repeat"
    }
}

enum PresentedSheet: String, Identifiable, Sendable {
    case search
    case library
    case settings

    var id: String { rawValue }
}

struct AppToast: Identifiable {
    let id = UUID()
    let message: String
    let actionTitle: String?
    let action: (() -> Void)?

    init(message: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }
}

@MainActor
@Observable
final class AppModel {
    private enum DefaultsKey {
        static let theme = "theme"
        static let repeatMode = "repeatMode"
        static let shuffle = "shuffle"
        static let keepScreenAwake = "keepScreenAwake"
        static let consentVersion = "consentVersion"
        static let selectedVideoID = "selectedVideoID"
    }

    private(set) var queue: [VideoSummary] = []
    private(set) var playlists: [SavedPlaylistData] = []
    private(set) var selectedVideoID: String?
    private(set) var playbackState: YouTubePlaybackState = .loading
    private(set) var isLoaded = false

    var presentedSheet: PresentedSheet?
    var toast: AppToast?
    var queueFilter = ""
    var pasteValue = ""
    var pasteError: String?
    var isAddingPastedVideo = false
    var queueFocusID: String?

    var searchQuery = ""
    var searchResults: [VideoSummary] = []
    var searchError: String?
    var isSearching = false

    var theme: ThemePreference {
        didSet { defaults.set(theme.rawValue, forKey: DefaultsKey.theme) }
    }

    var repeatMode: RepeatMode {
        didSet { defaults.set(repeatMode.rawValue, forKey: DefaultsKey.repeatMode) }
    }

    var shuffleEnabled: Bool {
        didSet {
            defaults.set(shuffleEnabled, forKey: DefaultsKey.shuffle)
            if let selectedVideoID {
                shuffleHistory = [selectedVideoID]
            } else {
                shuffleHistory = []
            }
        }
    }

    var keepScreenAwake: Bool {
        didSet {
            defaults.set(keepScreenAwake, forKey: DefaultsKey.keepScreenAwake)
            updateIdleTimer()
        }
    }

    private(set) var consentVersion: Int {
        didSet {
            defaults.set(consentVersion, forKey: DefaultsKey.consentVersion)
            writeWidgetSnapshot()
        }
    }

    let player: YouTubePlayerController

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let catalog: any VideoCatalogClient
    @ObservationIgnored private var repository: LibraryRepository?
    @ObservationIgnored private var shuffleHistory: Set<String> = []
    @ObservationIgnored private var isSceneActive = true
    @ObservationIgnored private var pendingPlaybackVideoID: String?
    @ObservationIgnored private var pendingCueVideoID: String?
    @ObservationIgnored private var pendingDeepLink: AppDeepLink?

    init(
        catalog: any VideoCatalogClient = YouTubeAPIClient(),
        defaults: UserDefaults = .standard,
        player: YouTubePlayerController = YouTubePlayerController()
    ) {
        self.catalog = catalog
        self.defaults = defaults
        self.player = player
        theme = ThemePreference(rawValue: defaults.string(forKey: DefaultsKey.theme) ?? "") ?? .system
        repeatMode = RepeatMode(rawValue: defaults.string(forKey: DefaultsKey.repeatMode) ?? "") ?? .off
        shuffleEnabled = defaults.bool(forKey: DefaultsKey.shuffle)
        keepScreenAwake = defaults.bool(forKey: DefaultsKey.keepScreenAwake)
        consentVersion = defaults.integer(forKey: DefaultsKey.consentVersion)
        selectedVideoID = defaults.string(forKey: DefaultsKey.selectedVideoID)

        player.onStateChange = { [weak self] state in
            self?.playbackState = state
            self?.updateIdleTimer()
        }
        player.onEnded = { [weak self] in
            self?.handlePlaybackEnded()
        }
    }

    var hasValidConsent: Bool {
        consentVersion == AppConstants.currentConsentVersion
    }

    var selectedVideo: VideoSummary? {
        guard let selectedVideoID else { return nil }
        return queue.first { $0.id == selectedVideoID }
    }

    var selectedQueueIndex: Int? {
        guard let selectedVideoID else { return nil }
        return queue.firstIndex { $0.id == selectedVideoID }
    }

    var filteredQueue: [VideoSummary] {
        let normalizedFilter = queueFilter.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedFilter.isEmpty else { return queue }
        return queue.filter {
            $0.title.localizedCaseInsensitiveContains(normalizedFilter)
                || $0.channelTitle.localizedCaseInsensitiveContains(normalizedFilter)
        }
    }

    func attach(modelContext: ModelContext) {
        guard repository == nil else { return }
        let repository = LibraryRepository(context: modelContext)
        self.repository = repository

        do {
            queue = try repository.loadQueue()
            playlists = try repository.loadPlaylists()
            if selectedVideoID.flatMap({ id in queue.first(where: { $0.id == id }) }) == nil {
                setSelectedVideoID(queue.first?.id)
            }
            if hasValidConsent, let selectedVideoID {
                player.cue(videoID: selectedVideoID)
            }
        } catch {
            showToast("Your saved library couldn’t be loaded.")
        }

        isLoaded = true
        writeWidgetSnapshot()
        if hasValidConsent {
            Task { await refreshStaleMetadata() }
        }
    }

    func acceptConsent() {
        consentVersion = AppConstants.currentConsentVersion
        if let selectedVideoID {
            player.cue(videoID: selectedVideoID)
        }
        if let pendingDeepLink {
            self.pendingDeepLink = nil
            handle(pendingDeepLink)
        }
        Task { await refreshStaleMetadata() }
    }

    func declineConsent() {
        consentVersion = 0
        pause()
        presentedSheet = nil
    }

    func present(_ sheet: PresentedSheet) {
        guard hasValidConsent else { return }
        pause()
        presentedSheet = sheet
    }

    func dismissSheet() {
        presentedSheet = nil
    }

    func sheetDidDismiss() {
        if let pendingPlaybackVideoID {
            self.pendingPlaybackVideoID = nil
            pendingCueVideoID = nil
            startPlaybackAfterPlayerBecomesVisible(videoID: pendingPlaybackVideoID)
        } else if let pendingCueVideoID {
            self.pendingCueVideoID = nil
            selectWithoutPlaying(videoID: pendingCueVideoID)
        }
    }

    func sceneActivityChanged(isActive: Bool) {
        isSceneActive = isActive
        if !isActive {
            pause()
            writeWidgetSnapshot()
        }
        updateIdleTimer()
    }

    func togglePlayback() {
        guard selectedVideo != nil, presentedSheet == nil, isSceneActive else { return }
        switch playbackState {
        case .playing, .buffering:
            player.pause()
        default:
            player.play()
        }
    }

    func pause() {
        player.pause()
        updateIdleTimer()
    }

    func play(_ video: VideoSummary) {
        _ = addVideoIfNeeded(video)
        setSelectedVideoID(video.id)
        if presentedSheet != nil {
            pendingPlaybackVideoID = video.id
            presentedSheet = nil
        } else {
            startPlaybackAfterPlayerBecomesVisible(videoID: video.id)
        }
    }

    func selectWithoutPlaying(videoID: String) {
        guard queue.contains(where: { $0.id == videoID }) else { return }
        pause()
        setSelectedVideoID(videoID)
        player.cue(videoID: videoID)
    }

    func previous() {
        advance(by: -1, shouldPlay: true)
    }

    func next() {
        advance(by: 1, shouldPlay: true)
    }

    func cycleRepeatMode() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
        showToast(repeatMode.label)
    }

    func toggleShuffle() {
        shuffleEnabled.toggle()
        showToast(shuffleEnabled ? "Shuffle on" : "Shuffle off")
    }

    func addSearchResult(_ video: VideoSummary) {
        guard addVideoIfNeeded(video) else {
            showToast("Already in your queue")
            return
        }
        showToast("Added to your queue")
    }

    func search() async {
        guard hasValidConsent else { return }
        isSearching = true
        searchError = nil
        defer { isSearching = false }

        do {
            searchResults = try await catalog.search(query: searchQuery, limit: 8).items
        } catch {
            searchResults = []
            searchError = error.localizedDescription
        }
    }

    func addPastedVideo() async {
        pasteError = nil
        guard let videoID = YouTubeVideoID.parse(pasteValue) else {
            pasteError = VideoCatalogError.invalidVideoID.localizedDescription
            return
        }
        guard !queue.contains(where: { $0.id == videoID }) else {
            pasteError = "That video is already in your queue."
            return
        }

        isAddingPastedVideo = true
        defer { isAddingPastedVideo = false }

        do {
            let response = try await catalog.videos(ids: [videoID])
            guard let video = response.items.first else {
                pasteError = "That video is unavailable, live, or can’t be embedded."
                return
            }
            _ = addVideoIfNeeded(video)
            pasteValue = ""
            showToast("Added to your queue")
        } catch {
            pasteError = error.localizedDescription
        }
    }

    func deleteFromQueue(videoID: String) {
        guard let index = queue.firstIndex(where: { $0.id == videoID }) else { return }
        let removed = queue.remove(at: index)
        let wasSelected = selectedVideoID == videoID

        if wasSelected {
            pause()
            let replacementIndex = min(index, queue.count - 1)
            let replacementID = replacementIndex >= 0 ? queue[replacementIndex].id : nil
            setSelectedVideoID(replacementID)
            if let replacementID {
                player.cue(videoID: replacementID)
            } else {
                player.stop()
            }
        }
        persistQueueAndSnapshot()

        toast = AppToast(message: "Removed from your queue", actionTitle: "Undo") { [weak self] in
            guard let self else { return }
            let insertionIndex = min(index, self.queue.count)
            self.queue.insert(removed, at: insertionIndex)
            if wasSelected {
                self.setSelectedVideoID(removed.id)
                self.player.cue(videoID: removed.id)
            }
            self.persistQueueAndSnapshot()
        }
    }

    func moveQueueItems(from source: IndexSet, to destination: Int) {
        guard queueFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            showToast("Clear the queue filter before reordering.")
            return
        }
        queue.move(fromOffsets: source, toOffset: destination)
        persistQueueAndSnapshot()
    }

    func saveCurrentQueue(name: String) -> Bool {
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty, !queue.isEmpty, let repository else { return false }

        do {
            let playlist = try repository.savePlaylist(name: normalizedName, videos: queue)
            playlists.insert(playlist, at: 0)
            showToast("Saved \(playlist.name)")
            return true
        } catch {
            showToast("The playlist couldn’t be saved.")
            return false
        }
    }

    func replaceQueue(with playlist: SavedPlaylistData, shouldPlay: Bool) {
        pause()
        queue = playlist.videos
        setSelectedVideoID(queue.first?.id)
        persistQueueAndSnapshot()

        if let first = queue.first {
            player.cue(videoID: first.id)
            if shouldPlay {
                pendingPlaybackVideoID = first.id
                presentedSheet = nil
            }
        } else {
            player.stop()
        }
    }

    func appendPlaylist(_ playlist: SavedPlaylistData) {
        let existingIDs = Set(queue.map(\.id))
        let newVideos = playlist.videos.filter { !existingIDs.contains($0.id) }
        guard !newVideos.isEmpty else {
            showToast("Every song is already in your queue.")
            return
        }
        queue.append(contentsOf: newVideos)
        if selectedVideoID == nil, let first = queue.first {
            setSelectedVideoID(first.id)
            player.cue(videoID: first.id)
        }
        persistQueueAndSnapshot()
        showToast("Added \(newVideos.count) to your queue")
    }

    func deletePlaylist(_ playlist: SavedPlaylistData) {
        guard let repository else { return }
        do {
            try repository.deletePlaylist(id: playlist.id)
            playlists.removeAll { $0.id == playlist.id }
            toast = AppToast(message: "Deleted \(playlist.name)", actionTitle: "Undo") { [weak self] in
                guard let self, let repository = self.repository else { return }
                do {
                    try repository.restorePlaylist(playlist)
                    self.playlists.insert(playlist, at: 0)
                } catch {
                    self.showToast("The playlist couldn’t be restored.")
                }
            }
        } catch {
            showToast("The playlist couldn’t be deleted.")
        }
    }

    func clearLocalLibrary() {
        guard let repository else { return }
        do {
            try repository.clearAll()
            pause()
            queue = []
            playlists = []
            setSelectedVideoID(nil)
            player.stop()
            writeWidgetSnapshot()
            showToast("Local queue and playlists cleared")
        } catch {
            showToast("Your local library couldn’t be cleared.")
        }
    }

    func handle(url: URL) {
        guard let deepLink = DeepLinkParser.parse(url) else { return }
        handle(deepLink)
    }

    func handle(_ deepLink: AppDeepLink) {
        guard hasValidConsent else {
            pendingDeepLink = deepLink
            return
        }

        switch deepLink {
        case .search:
            present(.search)
        case .library:
            present(.library)
        case let .queue(focusVideoID):
            presentedSheet = nil
            queueFilter = ""
            queueFocusID = focusVideoID
        case let .player(videoID):
            if queue.contains(where: { $0.id == videoID }) {
                cueDeepLinkedVideoWhenVisible(videoID: videoID)
            } else {
                // Close any covering surface before fetching. The fetched item is
                // only cued after the full-width player has become visible again.
                presentedSheet = nil
                Task { await loadDeepLinkedVideo(videoID: videoID) }
            }
        }
    }

    private func loadDeepLinkedVideo(videoID: String) async {
        do {
            guard let video = try await catalog.videos(ids: [videoID]).items.first else {
                showToast("That video is unavailable or can’t be embedded.")
                return
            }
            _ = addVideoIfNeeded(video, cueIfFirst: false)
            cueDeepLinkedVideoWhenVisible(videoID: video.id)
        } catch {
            showToast(error.localizedDescription)
        }
    }

    private func cueDeepLinkedVideoWhenVisible(videoID: String) {
        guard queue.contains(where: { $0.id == videoID }) else { return }
        pause()
        setSelectedVideoID(videoID)

        if presentedSheet != nil {
            pendingCueVideoID = videoID
            presentedSheet = nil
        } else {
            // Yield one render pass so a cold-launch or newly selected player is
            // mounted before the official YouTube iframe receives the cue.
            Task { @MainActor [weak self] in
                await Task.yield()
                guard let self,
                      self.isSceneActive,
                      self.presentedSheet == nil,
                      self.selectedVideoID == videoID
                else {
                    return
                }
                self.player.cue(videoID: videoID)
            }
        }
    }

    private func addVideoIfNeeded(
        _ video: VideoSummary,
        cueIfFirst: Bool = true
    ) -> Bool {
        guard video.embeddable, !queue.contains(where: { $0.id == video.id }) else {
            return false
        }
        queue.append(video)
        if selectedVideoID == nil {
            setSelectedVideoID(video.id)
            if cueIfFirst {
                player.cue(videoID: video.id)
            }
        }
        persistQueueAndSnapshot()
        return true
    }

    private func setSelectedVideoID(_ videoID: String?) {
        selectedVideoID = videoID
        defaults.set(videoID, forKey: DefaultsKey.selectedVideoID)
        if let videoID {
            shuffleHistory.insert(videoID)
        }
        writeWidgetSnapshot()
    }

    private func startPlaybackAfterPlayerBecomesVisible(videoID: String) {
        guard isSceneActive, presentedSheet == nil else { return }
        player.cue(videoID: videoID)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard let self,
                  self.isSceneActive,
                  self.presentedSheet == nil,
                  self.selectedVideoID == videoID
            else {
                return
            }
            self.player.play()
        }
    }

    private func advance(by delta: Int, shouldPlay: Bool) {
        guard !queue.isEmpty else { return }
        let currentIndex = selectedQueueIndex ?? (delta < 0 ? 0 : -1)
        let nextIndex: Int

        if shuffleEnabled, delta > 0, queue.count > 1 {
            var candidates = queue.indices.filter { !shuffleHistory.contains(queue[$0].id) }
            if candidates.isEmpty {
                if let selectedVideoID {
                    shuffleHistory = [selectedVideoID]
                } else {
                    shuffleHistory = []
                }
                candidates = queue.indices.filter { queue[$0].id != selectedVideoID }
            }
            nextIndex = candidates.randomElement() ?? 0
        } else {
            nextIndex = (currentIndex + delta + queue.count) % queue.count
        }

        let nextVideo = queue[nextIndex]
        setSelectedVideoID(nextVideo.id)
        player.cue(videoID: nextVideo.id)
        if shouldPlay {
            startPlaybackAfterPlayerBecomesVisible(videoID: nextVideo.id)
        }
    }

    private func handlePlaybackEnded() {
        guard isSceneActive, presentedSheet == nil else { return }
        if repeatMode == .one, let selectedVideoID {
            startPlaybackAfterPlayerBecomesVisible(videoID: selectedVideoID)
            return
        }
        if repeatMode == .off,
           !shuffleEnabled,
           selectedQueueIndex == queue.indices.last {
            updateIdleTimer()
            return
        }
        advance(by: 1, shouldPlay: true)
    }

    private func persistQueueAndSnapshot() {
        do {
            try repository?.replaceQueue(with: queue)
        } catch {
            showToast("Your queue couldn’t be saved.")
        }
        writeWidgetSnapshot()
    }

    private func refreshStaleMetadata() async {
        guard hasValidConsent, let repository else { return }
        let allVideos = queue + playlists.flatMap(\.videos)
        let staleIDs = Array(
            Set(allVideos.filter { !$0.metadataIsFresh() }.map(\.id))
        )
        guard !staleIDs.isEmpty else { return }

        do {
            var refreshedVideos: [VideoSummary] = []
            var rejectedIDs: [String] = []
            for start in stride(from: 0, to: staleIDs.count, by: 50) {
                let end = min(start + 50, staleIDs.count)
                let response = try await catalog.videos(ids: Array(staleIDs[start..<end]))
                refreshedVideos.append(contentsOf: response.items)
                rejectedIDs.append(contentsOf: response.rejectedIds ?? [])
            }
            try repository.storeVideos(refreshedVideos)
            let replacements = Dictionary(uniqueKeysWithValues: refreshedVideos.map { ($0.id, $0) })
            queue = queue.compactMap { video in
                if rejectedIDs.contains(video.id) { return nil }
                return replacements[video.id] ?? video
            }
            try repository.replaceQueue(with: queue)
            playlists = try repository.loadPlaylists()
            if selectedVideoID.flatMap({ id in queue.first(where: { $0.id == id }) }) == nil {
                setSelectedVideoID(queue.first?.id)
            }
            writeWidgetSnapshot()
        } catch {
            // Stale cached metadata remains usable until the next foreground refresh.
        }
    }

    private func writeWidgetSnapshot() {
        let now = Date()
        let canExposeMetadata = hasValidConsent
        let selectedIndex = selectedQueueIndex ?? 0
        let orderedUpNext: [VideoSummary]
        if queue.isEmpty {
            orderedUpNext = []
        } else if selectedQueueIndex != nil {
            orderedUpNext = Array(
                (Array(queue[selectedIndex...]) + Array(queue[..<selectedIndex])).prefix(3)
            )
        } else {
            orderedUpNext = Array(queue.prefix(3))
        }
        let visibleVideos = canExposeMetadata ? orderedUpNext : []
        let expiration = visibleVideos
            .map { $0.refreshedAt.addingTimeInterval(AppConstants.metadataLifetime) }
            .min() ?? (canExposeMetadata ? now.addingTimeInterval(AppConstants.metadataLifetime) : now)

        let snapshot = WidgetSnapshot(
            generatedAt: now,
            metadataExpiresAt: expiration,
            consentVersion: consentVersion,
            selectedVideoID: canExposeMetadata ? selectedVideoID : nil,
            queueIndex: selectedIndex,
            queueCount: canExposeMetadata ? queue.count : 0,
            upNext: visibleVideos.map {
                WidgetTrack(videoID: $0.id, title: $0.title, channelTitle: $0.channelTitle)
            }
        )

        try? WidgetSnapshotStore.write(snapshot)
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = keepScreenAwake
            && isSceneActive
            && presentedSheet == nil
            && playbackState == .playing
    }

    private func showToast(_ message: String) {
        toast = AppToast(message: message)
    }
}
