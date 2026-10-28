import Foundation

public enum AppDeepLink: Equatable, Sendable {
    case player(videoID: String)
    case queue(focusVideoID: String?)
    case search
    case library
}

public enum DeepLinkParser {
    public static func parse(_ url: URL) -> AppDeepLink? {
        guard let scheme = url.scheme?.lowercased() else { return nil }

        let pathParts = url.pathComponents.filter { $0 != "/" }
        let routeParts: [String]

        if scheme == AppConstants.customURLScheme {
            guard url.host?.lowercased() == "open" else { return nil }
            routeParts = ["open"] + pathParts
        } else if scheme == "https" {
            guard url.host?.lowercased() == AppConstants.universalLinkHost else { return nil }
            routeParts = pathParts
        } else {
            return nil
        }

        guard routeParts.first == "open", routeParts.count >= 2 else { return nil }

        switch routeParts[1] {
        case "player" where routeParts.count == 3:
            guard YouTubeVideoID.isValid(routeParts[2]) else { return nil }
            return .player(videoID: routeParts[2])
        case "queue" where routeParts.count == 2:
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let focus = components?.queryItems?.first(where: { $0.name == "focus" })?.value
            if let focus, !YouTubeVideoID.isValid(focus) { return nil }
            return .queue(focusVideoID: focus)
        case "search" where routeParts.count == 2:
            return .search
        case "library" where routeParts.count == 2:
            return .library
        default:
            return nil
        }
    }
}
