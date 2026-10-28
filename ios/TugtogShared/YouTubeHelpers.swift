import Foundation

public enum YouTubeVideoID {
    private static let allowedCharacters = CharacterSet.alphanumerics
        .union(CharacterSet(charactersIn: "-_"))

    public static func isValid(_ candidate: String) -> Bool {
        candidate.count == 11
            && candidate.unicodeScalars.allSatisfy(allowedCharacters.contains)
    }

    public static func parse(_ input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if isValid(trimmed) {
            return trimmed
        }

        guard let components = URLComponents(string: trimmed),
              let host = components.host?.lowercased()
        else {
            return nil
        }

        let pathParts = components.path.split(separator: "/").map(String.init)
        let candidate: String?

        switch host {
        case "youtu.be", "www.youtu.be":
            candidate = pathParts.first
        case "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com":
            if let value = components.queryItems?.first(where: { $0.name == "v" })?.value {
                candidate = value
            } else if let first = pathParts.first,
                      ["embed", "shorts", "live"].contains(first),
                      pathParts.count > 1 {
                candidate = pathParts[1]
            } else {
                candidate = nil
            }
        default:
            candidate = nil
        }

        guard let candidate, isValid(candidate) else {
            return nil
        }
        return candidate
    }
}

public enum ISO8601Duration {
    public static func seconds(from value: String) -> Int? {
        guard value.first == "P" else { return nil }

        var total = 0.0
        var number = ""
        var isTimeComponent = false

        for character in value.dropFirst() {
            if character == "T" {
                guard number.isEmpty else { return nil }
                isTimeComponent = true
                continue
            }

            if character.isNumber || character == "." {
                number.append(character)
                continue
            }

            guard let numericValue = Double(number) else { return nil }
            number = ""

            switch character {
            case "D" where !isTimeComponent:
                total += numericValue * 86_400
            case "H" where isTimeComponent:
                total += numericValue * 3_600
            case "M" where isTimeComponent:
                total += numericValue * 60
            case "S" where isTimeComponent:
                total += numericValue
            default:
                return nil
            }
        }

        guard number.isEmpty, total >= 0 else { return nil }
        return Int(total.rounded())
    }
}

public enum PlaybackTimeFormatter {
    public static func string(seconds: Int) -> String {
        let safeValue = max(0, seconds)
        let hours = safeValue / 3_600
        let minutes = (safeValue % 3_600) / 60
        let remainingSeconds = safeValue % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds)
        }
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }
}
