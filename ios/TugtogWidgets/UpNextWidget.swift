import SwiftUI
import WidgetKit

struct TugtogUpNextEntry: TimelineEntry {
    enum Content: Sendable {
        case ready(WidgetSnapshot)
        case empty
        case stale
    }

    let date: Date
    let content: Content

    var transitionKey: String {
        switch content {
        case .ready(let snapshot):
            return snapshot.selectedVideoID ?? snapshot.upNext.first?.videoID ?? "ready"
        case .empty:
            return "empty"
        case .stale:
            return "stale"
        }
    }

    static let placeholder = TugtogUpNextEntry(
        date: .now,
        content: .ready(
            WidgetSnapshot(
                schemaVersion: 1,
                generatedAt: .now,
                metadataExpiresAt: .now.addingTimeInterval(30 * 24 * 60 * 60),
                consentVersion: AppConstants.currentConsentVersion,
                selectedVideoID: "dQw4w9WgXcQ",
                queueIndex: 0,
                queueCount: 3,
                upNext: [
                    WidgetTrack(
                        videoID: "dQw4w9WgXcQ",
                        title: "Your next favorite song",
                        channelTitle: "Tugtog Mix"
                    ),
                    WidgetTrack(
                        videoID: "M7lc1UVf-VE",
                        title: "Sunset drive",
                        channelTitle: "Late Night Radio"
                    ),
                    WidgetTrack(
                        videoID: "aqz-KE-bpKQ",
                        title: "One more track",
                        channelTitle: "Daily Replay"
                    ),
                ]
            )
        )
    )
}

struct TugtogUpNextProvider: TimelineProvider {
    func placeholder(in context: Context) -> TugtogUpNextEntry {
        .placeholder
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (TugtogUpNextEntry) -> Void
    ) {
        completion(context.isPreview ? .placeholder : makeEntry(at: .now))
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<TugtogUpNextEntry>) -> Void
    ) {
        let now = Date.now
        let entry = makeEntry(at: now)
        switch entry.content {
        case .ready(let snapshot):
            let expiryEntry = TugtogUpNextEntry(
                date: snapshot.metadataExpiresAt,
                content: .stale
            )
            completion(
                Timeline(
                    entries: [entry, expiryEntry],
                    policy: .after(snapshot.metadataExpiresAt.addingTimeInterval(6 * 60 * 60))
                )
            )
        case .empty, .stale:
            completion(
                Timeline(
                    entries: [entry],
                    policy: .after(now.addingTimeInterval(6 * 60 * 60))
                )
            )
        }
    }

    private func makeEntry(at now: Date) -> TugtogUpNextEntry {
        let snapshot: WidgetSnapshot
        do {
            guard let storedSnapshot = try WidgetSnapshotStore.read() else {
                return TugtogUpNextEntry(date: now, content: .empty)
            }
            snapshot = storedSnapshot
        } catch {
            return TugtogUpNextEntry(date: now, content: .stale)
        }

        guard snapshot.consentVersion == AppConstants.currentConsentVersion,
              snapshot.metadataExpiresAt > now
        else {
            return TugtogUpNextEntry(date: now, content: .stale)
        }

        guard let safeSnapshot = snapshot.sanitizedForDisplay(
            now: now,
            requiredConsentVersion: AppConstants.currentConsentVersion
        ), !safeSnapshot.upNext.isEmpty else {
            return TugtogUpNextEntry(date: now, content: .empty)
        }

        return TugtogUpNextEntry(date: now, content: .ready(safeSnapshot))
    }

}

struct TugtogUpNextWidget: Widget {
    private let kind = "TugtogUpNextWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TugtogUpNextProvider()) { entry in
            TugtogUpNextWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    TugtogWidgetBackground()
                }
        }
        .configurationDisplayName("Tugtog Up Next")
        .description("See what’s queued and jump back into Tugtog.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
            .accessoryInline,
        ])
        .contentMarginsDisabled()
    }
}
