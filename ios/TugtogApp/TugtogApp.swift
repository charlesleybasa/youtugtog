import SwiftData
import SwiftUI

@main
struct TugtogApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            TugtogRootView(model: model)
        }
        .modelContainer(
            for: [
                StoredVideo.self,
                QueueItem.self,
                SavedPlaylist.self,
                SavedPlaylistItem.self
            ]
        )
    }
}
