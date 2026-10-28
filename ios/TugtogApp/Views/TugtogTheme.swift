import SwiftUI

extension Color {
    static let tugtogOrange = Color(red: 1.00, green: 0.54, blue: 0.17)
    static let tugtogPink = Color(red: 0.96, green: 0.19, blue: 0.50)
    static let tugtogNavy = Color(red: 0.10, green: 0.12, blue: 0.15)
}

extension ShapeStyle where Self == LinearGradient {
    static var tugtogBrand: LinearGradient {
        LinearGradient(
            colors: [.tugtogOrange, .tugtogPink],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct TugtogDisc: View {
    let size: CGFloat
    var isPlaying = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !isPlaying || reduceMotion)) { context in
            disc
                .rotationEffect(.degrees(rotation(at: context.date)))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var disc: some View {
        ZStack {
            Circle()
                .fill(.tugtogBrand)
            Circle()
                .stroke(Color.white.opacity(0.36), lineWidth: max(1, size * 0.025))
                .padding(size * 0.13)
            Circle()
                .stroke(Color.white.opacity(0.22), lineWidth: max(1, size * 0.018))
                .padding(size * 0.27)
            Circle()
                .fill(Color.tugtogNavy.opacity(0.9))
                .frame(width: size * 0.32, height: size * 0.32)
            Image(systemName: "waveform")
                .font(.system(size: size * 0.18, weight: .bold))
                .foregroundStyle(.white)
        }
        .shadow(color: Color.tugtogPink.opacity(0.25), radius: size * 0.12, y: size * 0.05)
    }

    private func rotation(at date: Date) -> Double {
        guard isPlaying, !reduceMotion else { return 0 }
        return date.timeIntervalSinceReferenceDate
            .truncatingRemainder(dividingBy: 14) / 14 * 360
    }
}

struct TugtogCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24))
            .overlay {
                RoundedRectangle(cornerRadius: 24)
                    .stroke(Color.primary.opacity(0.06), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.08), radius: 16, y: 8)
    }
}

extension View {
    func tugtogCard() -> some View {
        modifier(TugtogCardModifier())
    }
}
