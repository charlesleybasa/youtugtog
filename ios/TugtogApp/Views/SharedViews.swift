import SwiftUI

struct VideoThumbnailView: View {
    let video: VideoSummary

    var body: some View {
        AsyncImage(url: video.thumbnailURL) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .scaledToFit()
            case .failure:
                placeholder
            case .empty:
                ZStack {
                    placeholder
                    ProgressView()
                }
            @unknown default:
                placeholder
            }
        }
        .background(Color.black)
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        Rectangle()
            .fill(Color(.quaternarySystemFill))
            .overlay {
                Image(systemName: "play.rectangle")
                    .foregroundStyle(.secondary)
            }
    }
}

struct AppToastView: View {
    @Bindable var model: AppModel

    var body: some View {
        if let toast = model.toast {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.tugtogBrand)
                Text(toast.message)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                Spacer(minLength: 0)
                if let actionTitle = toast.actionTitle, let action = toast.action {
                    Button(actionTitle) {
                        action()
                        model.toast = nil
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
            .padding()
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            .shadow(color: Color.black.opacity(0.16), radius: 14, y: 6)
            .padding()
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: toast.id) {
                try? await Task.sleep(for: .seconds(4))
                guard model.toast?.id == toast.id else { return }
                withAnimation { model.toast = nil }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isStaticText)
        }
    }
}
