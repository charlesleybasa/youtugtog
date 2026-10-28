import SwiftUI

struct QueueView: View {
    @Bindable var model: AppModel

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section("Add to your queue") {
                    HStack(spacing: 8) {
                        Image(systemName: "link")
                            .foregroundStyle(.secondary)
                        TextField("Paste a YouTube link", text: $model.pasteValue)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .autocorrectionDisabled()
                            .onSubmit { addPastedVideo() }

                        PasteButton(payloadType: String.self) { values in
                            model.pasteValue = values.first ?? ""
                            model.pasteError = nil
                        }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Paste YouTube link")

                        Button("Add") { addPastedVideo() }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.isAddingPastedVideo || model.pasteValue.isEmpty)
                    }

                    if let pasteError = model.pasteError {
                        Label(pasteError, systemImage: "exclamationmark.circle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    HStack {
                        Image(systemName: "line.3.horizontal.decrease")
                            .foregroundStyle(.secondary)
                        TextField("Filter your queue", text: $model.queueFilter)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if !model.queueFilter.isEmpty {
                            Button("Clear", systemImage: "xmark.circle.fill") {
                                model.queueFilter = ""
                            }
                            .labelStyle(.iconOnly)
                            .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    if model.filteredQueue.isEmpty {
                        ContentUnavailableView {
                            Label(
                                model.queue.isEmpty ? "Your queue is empty" : "No matches",
                                systemImage: model.queue.isEmpty ? "music.note.list" : "magnifyingglass"
                            )
                        } description: {
                            Text(
                                model.queue.isEmpty
                                    ? "Search YouTube Music or paste a link to add your first song."
                                    : "Try a different title or channel."
                            )
                        } actions: {
                            if model.queue.isEmpty {
                                Button("Search Music", systemImage: "magnifyingglass") {
                                    model.present(.search)
                                }
                                .buttonStyle(.borderedProminent)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(model.filteredQueue) { video in
                            QueueRow(
                                video: video,
                                isSelected: video.id == model.selectedVideoID,
                                isPlaying: video.id == model.selectedVideoID
                                    && model.playbackState == .playing
                            ) {
                                if video.id == model.selectedVideoID {
                                    model.togglePlayback()
                                } else {
                                    model.play(video)
                                }
                            }
                            .id(video.id)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    model.deleteFromQueue(videoID: video.id)
                                }
                            }
                        }
                        .onMove(perform: model.moveQueueItems)
                    }
                } header: {
                    HStack {
                        Text("Your queue")
                        Spacer()
                        Text("\(model.queue.count) \(model.queue.count == 1 ? "song" : "songs")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if model.queue.count > 1 {
                            EditButton()
                                .textCase(nil)
                        }
                    }
                } footer: {
                    if model.queue.count > 1 {
                        Text("Use Edit to reorder, or swipe a song to remove it.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.queueFocusID) { _, videoID in
                guard let videoID else { return }
                withAnimation {
                    proxy.scrollTo(videoID, anchor: .center)
                }
                model.queueFocusID = nil
            }
        }
    }

    private func addPastedVideo() {
        Task { await model.addPastedVideo() }
    }
}

private struct QueueRow: View {
    let video: VideoSummary
    let isSelected: Bool
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VideoThumbnailView(video: video)
                    .frame(width: 88)

                VStack(alignment: .leading, spacing: 4) {
                    Text(video.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
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

                Spacer(minLength: 0)
                if isSelected {
                    Image(systemName: isPlaying ? "speaker.wave.2.fill" : "speaker.fill")
                        .foregroundStyle(.tugtogBrand)
                        .symbolEffect(.variableColor.iterative, isActive: isPlaying)
                        .accessibilityLabel(isPlaying ? "Playing" : "Selected")
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(isSelected ? "Toggles playback" : "Selects and plays this video")
    }
}
