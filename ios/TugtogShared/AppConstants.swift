import Foundation

public enum AppConstants {
    public static let appName = "Tugtog"
    public static let currentConsentVersion = 1

    // Replace these placeholders before signing a production build.
    public static let appGroupIdentifier = "group.com.example.tugtog"
    public static let universalLinkHost = "tugtog.example.com"
    public static let customURLScheme = "tugtog"
    public static let widgetSnapshotFilename = "widget-snapshot-v1.json"

    public static let apiBaseURL = URL(string: "https://tugtog.example.com")!
    public static let playerOriginURL = URL(string: "https://com.example.tugtog")!

    public static let privacyURL = URL(string: "https://tugtog.example.com/privacy")!
    public static let termsURL = URL(string: "https://tugtog.example.com/terms")!
    public static let supportURL = URL(string: "https://tugtog.example.com/support")!
    public static let googlePrivacyURL = URL(string: "https://policies.google.com/privacy")!
    public static let youtubeTermsURL = URL(string: "https://www.youtube.com/t/terms")!

    public static let metadataLifetime: TimeInterval = 30 * 24 * 60 * 60
}
