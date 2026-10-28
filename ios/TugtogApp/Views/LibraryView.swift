import SwiftUI

struct LibraryView: View {
    @Bindable var model: AppModel
    @State private var pendingPlaylist: SavedPlaylistData?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        SaveQueueView(model: model)
                    } label: {
                        Label("Save Current Queue", systemImage: "square.and.arrow.down")
                    }
                    .disabled(model.queue.isEmpty)
                } footer: {
                    Text("Playlists are stored only on this iPhone.")
                }

                Section("Saved playlists") {
                    if model.playlists.isEmpty {
                        ContentUnavailableView {
                            Label("No saved playlists", systemImage: "music.note.list")
                        } description: {
                            Text("Build a queue, then save an immutable copy here.")
                        }
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(model.playlists) { playlist in
                            Button {
                                pendingPlaylist = playlist
                            } label: {
                                PlaylistRow(playlist: playlist)
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                Button("Add to Queue", systemImage: "text.badge.plus") {
                                    model.appendPlaylist(playlist)
                                }
                                .tint(.tugtogOrange)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    model.deletePlaylist(playlist)
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("My Playlists")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        model.dismissSheet()
                    }
                    .labelStyle(.iconOnly)
                }
            }
            .confirmationDialog(
                "Replace your current queue?",
                isPresented: Binding(
                    get: { pendingPlaylist != nil },
                    set: { if !$0 { pendingPlaylist = nil } }
                ),
                titleVisibility: .visible
            ) {
                if let playlist = pendingPlaylist {
                    Button("Play \(playlist.name)") {
                        model.replaceQueue(with: playlist, shouldPlay: true)
                    }
                    Button("Load Without Playing") {
                        model.replaceQueue(with: playlist, shouldPlay: false)
                        model.dismissSheet()
                    }
                    Button("Add to Current Queue") {
                        model.appendPlaylist(playlist)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                if let playlist = pendingPlaylist {
                    Text("\(playlist.name) contains \(playlist.videos.count) songs.")
                }
            }
        }
    }
}

private struct PlaylistRow: View {
    let playlist: SavedPlaylistData

    var body: some View {
        HStack(spacing: 12) {
            TugtogDisc(size: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(playlist.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text("\(playlist.videos.count) \(playlist.videos.count == 1 ? "song" : "songs")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(playlist.createdAt, format: .dateTime.month(.abbreviated).day().year())
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            Image(systemName: "ellipsis.circle")
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }
}

private struct SaveQueueView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = "My playlist"

    private var normalizedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        Form {
            Section("Playlist name") {
                TextField("Name", text: $name)
                    .textInputAutocapitalization(.words)
            }
            Section("Snapshot") {
                LabeledContent("Songs", value: "\(model.queue.count)")
                Text("Future queue edits won’t change this saved playlist.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Save Queue")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", systemImage: "checkmark") {
                    if model.saveCurrentQueue(name: normalizedName) {
                        dismiss()
                    }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderedProminent)
                .disabled(normalizedName.isEmpty || model.queue.isEmpty)
            }
        }
    }
}
