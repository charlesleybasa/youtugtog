import SwiftUI
import WidgetKit

struct TugtogUpNextWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let entry: TugtogUpNextEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                smallView
            case .systemMedium:
                mediumView
            case .accessoryRectangular:
                rectangularView
            case .accessoryInline:
                inlineView
            default:
                smallView
            }
        }
        .id(entry.transitionKey)
        .contentTransition(.opacity)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.28), value: entry.transitionKey)
        .privacySensitive()
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var smallView: some View {
        switch entry.content {
        case .ready(let snapshot):
            let track = snapshot.upNext[0]
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    TugtogDisc(size: 54)
                        .accessibilityHidden(true)
                    Spacer(minLength: 8)
                    QueueCountBadge(count: snapshot.queueCount)
                }

                Spacer(minLength: 8)
                WidgetKicker(text: "UP NEXT")
                Text(track.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.84)
                Text(track.channelTitle)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(1)
                YouTubeAttribution()
                    .padding(.top, 5)
            }
            .padding(14)
            .widgetURL(WidgetDeepLink.player(videoID: track.videoID))
            .accessibilityLabel(
                "Up next, \(track.title), by \(track.channelTitle). \(snapshot.queueCount) tracks in queue."
            )

        case .empty:
            WidgetMessageView(
                symbol: "music.note.list",
                title: "Queue something good",
                detail: "Open Tugtog to find your next track."
            )
            .widgetURL(WidgetDeepLink.search)

        case .stale:
            WidgetMessageView(
                symbol: "arrow.clockwise",
                title: "Open Tugtog to refresh",
                detail: "Your private queue details are hidden."
            )
            .widgetURL(WidgetDeepLink.queue)
        }
    }

    @ViewBuilder
    private var mediumView: some View {
        switch entry.content {
        case .ready(let snapshot):
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 9) {
                    TugtogDisc(size: 76)
                        .accessibilityHidden(true)
                    WidgetKicker(text: "UP NEXT")
                    Text("\(snapshot.queueCount) in queue")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.68))
                    Spacer(minLength: 0)
                    HStack(spacing: 12) {
                        Link(destination: WidgetDeepLink.search) {
                            Label("Search", systemImage: "magnifyingglass")
                                .labelStyle(.iconOnly)
                        }
                        .accessibilityLabel("Search Tugtog")

                        Link(destination: WidgetDeepLink.queue) {
                            Label("Queue", systemImage: "list.bullet")
                                .labelStyle(.iconOnly)
                        }
                        .accessibilityLabel("Open queue")
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                }
                .frame(width: 92, alignment: .leading)

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(snapshot.upNext.prefix(3).enumerated()), id: \.element.videoID) { index, track in
                        Link(destination: WidgetDeepLink.player(videoID: track.videoID)) {
                            MediumTrackRow(position: snapshot.queueIndex + index + 1, track: track)
                        }
                        .buttonStyle(.plain)

                        if index < min(snapshot.upNext.count, 3) - 1 {
                            Divider()
                                .overlay(.white.opacity(0.14))
                        }
                    }
                    Spacer(minLength: 0)
                    YouTubeAttribution()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)

        case .empty:
            HStack(spacing: 18) {
                TugtogDisc(size: 84)
                    .accessibilityHidden(true)
                WidgetMessageView(
                    symbol: "music.note.list",
                    title: "Queue something good",
                    detail: "Open Search and add up to your next three tracks."
                )
            }
            .padding(16)
            .widgetURL(WidgetDeepLink.search)

        case .stale:
            HStack(spacing: 18) {
                TugtogDisc(size: 84)
                    .accessibilityHidden(true)
                WidgetMessageView(
                    symbol: "arrow.clockwise",
                    title: "Open Tugtog to refresh",
                    detail: "Queue details stay private until the app refreshes them."
                )
            }
            .padding(16)
            .widgetURL(WidgetDeepLink.queue)
        }
    }

    @ViewBuilder
    private var rectangularView: some View {
        switch entry.content {
        case .ready(let snapshot):
            let track = snapshot.upNext[0]
            HStack(spacing: 8) {
                Image(systemName: "waveform.circle.fill")
                    .font(.title3)
                    .widgetAccentable()
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(track.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text("\(track.channelTitle) · via YouTube")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .widgetURL(WidgetDeepLink.player(videoID: track.videoID))
            .accessibilityLabel("Up next, \(track.title), by \(track.channelTitle), via YouTube")

        case .empty:
            Label("Queue something good", systemImage: "music.note.list")
                .widgetURL(WidgetDeepLink.search)

        case .stale:
            Label("Open Tugtog to refresh", systemImage: "arrow.clockwise")
                .widgetURL(WidgetDeepLink.queue)
        }
    }

    @ViewBuilder
    private var inlineView: some View {
        switch entry.content {
        case .ready(let snapshot):
            let track = snapshot.upNext[0]
            Label("Tugtog · Up next: \(track.title)", systemImage: "music.note.list")
                .widgetURL(WidgetDeepLink.player(videoID: track.videoID))
                .accessibilityLabel("Tugtog. Up next, \(track.title), via YouTube")
        case .empty:
            Label("Tugtog · Queue something good", systemImage: "music.note.list")
                .widgetURL(WidgetDeepLink.search)
        case .stale:
            Label("Tugtog · Open to refresh", systemImage: "arrow.clockwise")
                .widgetURL(WidgetDeepLink.queue)
        }
    }
}

struct TugtogWidgetBackground: View {
    var body: some View {
        ZStack {
            Color(red: 0.055, green: 0.067, blue: 0.10)
            RadialGradient(
                colors: [
                    Color(red: 1.0, green: 0.30, blue: 0.52).opacity(0.26),
                    Color.clear,
                ],
                center: .topLeading,
                startRadius: 0,
                endRadius: 210
            )
        }
    }
}

private struct TugtogDisc: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 1.0, green: 0.62, blue: 0.16).opacity(0.58),
                            Color(red: 1.0, green: 0.25, blue: 0.50).opacity(0.18),
                            .clear,
                        ],
                        center: .center,
                        startRadius: 4,
                        endRadius: size * 0.64
                    )
                )
                .blur(radius: size * 0.09)
                .scaleEffect(1.13)

            Circle()
                .fill(
                    AngularGradient(
                        colors: [
                            Color(red: 1.0, green: 0.60, blue: 0.14),
                            Color(red: 1.0, green: 0.28, blue: 0.48),
                            Color(red: 0.96, green: 0.18, blue: 0.63),
                            Color(red: 1.0, green: 0.60, blue: 0.14),
                        ],
                        center: .center
                    )
                )

            ForEach([0.73, 0.52], id: \.self) { scale in
                Circle()
                    .stroke(.white.opacity(0.28), lineWidth: max(1, size * 0.018))
                    .scaleEffect(scale)
            }

            Circle()
                .fill(Color(red: 0.055, green: 0.067, blue: 0.10))
                .frame(width: size * 0.34, height: size * 0.34)

            Image(systemName: "waveform")
                .font(.system(size: size * 0.17, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

private struct QueueCountBadge: View {
    let count: Int

    var body: some View {
        Label("\(count)", systemImage: "music.note.list")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 5)
            .background(.white.opacity(0.12), in: Capsule())
            .accessibilityLabel("\(count) tracks in queue")
    }
}

private struct WidgetKicker: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .tracking(0.8)
            .foregroundStyle(Color(red: 1.0, green: 0.55, blue: 0.26))
    }
}

private struct YouTubeAttribution: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "play.rectangle")
                .accessibilityHidden(true)
            Text("via YouTube")
        }
        .font(.caption2)
        .foregroundStyle(.white.opacity(0.62))
    }
}

private struct MediumTrackRow: View {
    let position: Int
    let track: WidgetTrack

    var body: some View {
        HStack(spacing: 9) {
            Text("\(position)")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white.opacity(0.5))
                .frame(width: 18, alignment: .trailing)
            VStack(alignment: .leading, spacing: 1) {
                Text(track.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(track.channelTitle)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.62))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white.opacity(0.45))
                .accessibilityHidden(true)
        }
        .frame(minHeight: 36)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Track \(position), \(track.title), by \(track.channelTitle)")
    }
}

private struct WidgetMessageView: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            Color(red: 1.0, green: 0.62, blue: 0.16),
                            Color(red: 0.96, green: 0.18, blue: 0.63),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundStyle(.white)
                .lineLimit(2)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.68))
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private enum WidgetDeepLink {
    static let search = universal(path: "/open/search", fallback: "tugtog://open/search")
    static let queue = universal(path: "/open/queue", fallback: "tugtog://open/queue")

    static func player(videoID: String) -> URL {
        let allowedID = videoID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? videoID
        return universal(
            path: "/open/player/\(allowedID)",
            fallback: "tugtog://open/player/\(allowedID)"
        )
    }

    private static func universal(path: String, fallback: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = AppConstants.universalLinkHost
        components.path = path
        return components.url ?? URL(string: fallback)!
    }
}
