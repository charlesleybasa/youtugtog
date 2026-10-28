import SwiftUI

struct SearchView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                if model.isSearching {
                    HStack {
                        Spacer()
                        ProgressView("Searching YouTube Music…")
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                } else if let searchError = model.searchError {
                    ContentUnavailableView {
                        Label("Search unavailable", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(searchError)
                    } actions: {
                        Button("Try Again", action: runSearch)
                            .buttonStyle(.borderedProminent)
                    }
                    .listRowBackground(Color.clear)
                } else if model.searchResults.isEmpty {
                    ContentUnavailableView {
                        Label("Find your next song", systemImage: "music.note")
                    } description: {
                        Text("Search embeddable music videos, then add one or play it in Tugtog.")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    Section("Music videos") {
                        ForEach(model.searchResults) { video in
                            SearchResultRow(
                                video: video,
                                isQueued: model.queue.contains { $0.id == video.id },
                                onAdd: { model.addSearchResult(video) },
                                onPlay: { model.play(video) }
                            )
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Search Music")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $model.searchQuery, prompt: "Search YouTube Music")
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(of: .search, runSearch)
            .safeAreaInset(edge: .bottom) {
                Label("Results provided via YouTube", systemImage: "play.rectangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(.bar)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        model.dismissSheet()
                    }
                    .labelStyle(.iconOnly)
                }
            }
        }
    }

    private func runSearch() {
        Task { await model.search() }
    }
}

private struct SearchResultRow: View {
    let video: VideoSummary
    let isQueued: Bool
    let onAdd: () -> Void
    let onPlay: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VideoThumbnailView(video: video)
                    .frame(width: 112)

                VStack(alignment: .leading, spacing: 4) {
                    Text(video.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(3)
                    Text(video.channelTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if video.durationSeconds > 0 {
                        Text(PlaybackTimeFormatter.string(seconds: video.durationSeconds))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            HStack {
                Button(isQueued ? "Queued" : "Add", systemImage: isQueued ? "checkmark" : "plus") {
                    onAdd()
                }
                .buttonStyle(.bordered)
                .disabled(isQueued)

                Spacer()

                Button("Play", systemImage: "play.fill", action: onPlay)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(.vertical, 4)
    }
}
