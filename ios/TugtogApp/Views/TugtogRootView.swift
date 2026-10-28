import SwiftData
import SwiftUI

struct TugtogRootView: View {
    @Bindable var model: AppModel

    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if !model.isLoaded {
                ProgressView("Loading Tugtog…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !model.hasValidConsent {
                ConsentView(model: model)
            } else {
                MainView(model: model)
            }
        }
        .background(Color(.systemGroupedBackground))
        .tint(.tugtogPink)
        .preferredColorScheme(model.theme.colorScheme)
        .overlay(alignment: .bottom) {
            AppToastView(model: model)
        }
        .task {
            model.attach(modelContext: modelContext)
            model.sceneActivityChanged(isActive: scenePhase == .active)
        }
        .onChange(of: scenePhase) { _, newPhase in
            model.sceneActivityChanged(isActive: newPhase == .active)
        }
        .onOpenURL { url in
            model.handle(url: url)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL {
                model.handle(url: url)
            }
        }
        .sheet(item: $model.presentedSheet, onDismiss: model.sheetDidDismiss) { sheet in
            switch sheet {
            case .search:
                SearchView(model: model)
            case .library:
                LibraryView(model: model)
            case .settings:
                SettingsView(model: model)
            }
        }
    }
}

private struct MainView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let video = model.selectedVideo {
                    PlayerCard(model: model, video: video)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                }
                QueueView(model: model)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Tugtog")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Tugtog")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.tugtogBrand)
                        Text("Build and play music queues")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }

                ToolbarItem(placement: .topBarLeading) {
                    Button("Settings", systemImage: "gearshape") {
                        model.present(.settings)
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Settings")
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Library", systemImage: "music.note.list") {
                        model.present(.library)
                    }
                    .labelStyle(.iconOnly)

                    Button("Search", systemImage: "magnifyingglass") {
                        model.present(.search)
                    }
                    .labelStyle(.iconOnly)
                }
            }
        }
    }
}

private struct PlayerCard: View {
    @Bindable var model: AppModel
    let video: VideoSummary

    var body: some View {
        VStack(spacing: 0) {
            YouTubePlayerView(controller: model.player)
                .frame(maxWidth: .infinity)
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(Color.black)
                .accessibilityLabel("YouTube player for \(video.title)")

            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    TugtogDisc(size: 54, isPlaying: model.playbackState == .playing)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.playbackState.statusLabel.uppercased())
                            .font(.caption2.weight(.bold))
                            .tracking(1.5)
                            .foregroundStyle(.secondary)
                        Text(video.title)
                            .font(.headline)
                            .lineLimit(2)
                        Text(video.channelTitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 14) {
                    Button("Shuffle", systemImage: "shuffle", action: model.toggleShuffle)
                        .labelStyle(.iconOnly)
                        .foregroundStyle(model.shuffleEnabled ? Color.tugtogPink : Color.secondary)
                        .accessibilityValue(model.shuffleEnabled ? "On" : "Off")

                    Button("Previous", systemImage: "backward.end.fill", action: model.previous)
                        .labelStyle(.iconOnly)

                    Button(
                        model.playbackState == .playing ? "Pause" : "Play",
                        systemImage: model.playbackState == .playing ? "pause.fill" : "play.fill",
                        action: model.togglePlayback
                    )
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                    .tint(.tugtogPink)

                    Button("Next", systemImage: "forward.end.fill", action: model.next)
                        .labelStyle(.iconOnly)

                    Button(model.repeatMode.label, systemImage: model.repeatMode.symbolName) {
                        model.cycleRepeatMode()
                    }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(model.repeatMode == .off ? Color.secondary : Color.tugtogPink)
                    .accessibilityValue(model.repeatMode.label)
                }
                .buttonStyle(.borderless)

                HStack {
                    Label("via YouTube", systemImage: "play.rectangle")
                    Spacer()
                    if video.durationSeconds > 0 {
                        Text(PlaybackTimeFormatter.string(seconds: video.durationSeconds))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if case let .failed(message) = model.playbackState {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
            .background(Color(.secondarySystemGroupedBackground))
            .overlay(alignment: .top) {
                Divider()
            }
        }
    }
}
