import SwiftUI

struct ConsentView: View {
    @Bindable var model: AppModel
    @State private var declined = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(spacing: 18) {
                    TugtogDisc(size: 112)
                    VStack(spacing: 6) {
                        Text("Welcome to Tugtog")
                            .font(.largeTitle.bold())
                            .multilineTextAlignment(.center)
                        Text("Build and play music queues")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }

                VStack(alignment: .leading, spacing: 16) {
                    ConsentPoint(
                        symbol: "play.rectangle.fill",
                        title: "Official YouTube playback",
                        detail: "Videos play through YouTube’s visible embedded player with its controls, branding, and ads intact."
                    )
                    ConsentPoint(
                        symbol: "iphone",
                        title: "Stored on this iPhone",
                        detail: "Your queue, playlists, settings, and widget snapshot stay locally on your device."
                    )
                    ConsentPoint(
                        symbol: "magnifyingglass",
                        title: "Search through YouTube APIs",
                        detail: "Tugtog sends your search words to its server to request music results from YouTube."
                    )
                }
                .padding()
                .tugtogCard()

                Text("By continuing, you agree to Tugtog’s Privacy Policy and Terms, and acknowledge that YouTube API features are subject to YouTube’s Terms of Service and Google’s Privacy Policy.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                VStack(spacing: 10) {
                    Link("Privacy Policy", destination: AppConstants.privacyURL)
                    Link("Terms of Use", destination: AppConstants.termsURL)
                    Link("YouTube Terms of Service", destination: AppConstants.youtubeTermsURL)
                    Link("Google Privacy Policy", destination: AppConstants.googlePrivacyURL)
                }
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity)

                if declined {
                    Label(
                        "YouTube features remain disabled. You can review the policies and continue whenever you’re ready.",
                        systemImage: "info.circle"
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding()
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                }

                Button("Agree and Continue") {
                    model.acceptConsent()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)

                Button("Not Now") {
                    declined = true
                    model.declineConsent()
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            }
            .padding()
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
    }
}

private struct ConsentPoint: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(.tugtogBrand)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
