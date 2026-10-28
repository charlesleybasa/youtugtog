import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showClearConfirmation = false
    @State private var showConsentConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: $model.theme) {
                        ForEach(ThemePreference.allCases) { theme in
                            Text(theme.label).tag(theme)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    Toggle("Keep Screen On While Playing", isOn: $model.keepScreenAwake)
                } footer: {
                    Text("Only active while Tugtog is visible and the official player is playing.")
                }

                Section("Legal and support") {
                    Link(destination: AppConstants.privacyURL) {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                    Link(destination: AppConstants.termsURL) {
                        Label("Terms of Use", systemImage: "doc.text")
                    }
                    Link(destination: AppConstants.supportURL) {
                        Label("Support", systemImage: "questionmark.circle")
                    }
                    Link(destination: AppConstants.googlePrivacyURL) {
                        Label("Google Privacy Policy", systemImage: "arrow.up.right.square")
                    }
                    Link(destination: AppConstants.youtubeTermsURL) {
                        Label("YouTube Terms of Service", systemImage: "arrow.up.right.square")
                    }
                }

                Section {
                    Button("Clear Queue and Playlists", systemImage: "trash", role: .destructive) {
                        showClearConfirmation = true
                    }
                    Button("Withdraw YouTube Consent", role: .destructive) {
                        showConsentConfirmation = true
                    }
                } header: {
                    Text("Local data")
                } footer: {
                    Text("Tugtog has no account or cloud sync. Queue and playlist data stays on this iPhone.")
                }

                Section("Playback") {
                    LabeledContent("Background audio", value: "Not enabled")
                    LabeledContent("Downloads", value: "Not enabled")
                    Text("Tugtog plays through YouTube’s visible official player and pauses when the app is covered, locked, or backgrounded.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
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
                "Clear local library?",
                isPresented: $showClearConfirmation,
                titleVisibility: .visible
            ) {
                Button("Clear Queue and Playlists", role: .destructive) {
                    model.clearLocalLibrary()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently removes every local queue item and saved playlist.")
            }
            .confirmationDialog(
                "Withdraw consent?",
                isPresented: $showConsentConfirmation,
                titleVisibility: .visible
            ) {
                Button("Withdraw Consent", role: .destructive) {
                    model.declineConsent()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("YouTube-backed features will remain unavailable until you accept again.")
            }
        }
    }
}
