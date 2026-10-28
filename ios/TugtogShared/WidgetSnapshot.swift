import Foundation

public struct WidgetTrack: Codable, Equatable, Hashable, Sendable {
    public let videoID: String
    public let title: String
    public let channelTitle: String

    public init(videoID: String, title: String, channelTitle: String) {
        self.videoID = videoID
        self.title = title
        self.channelTitle = channelTitle
    }
}

public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let generatedAt: Date
    public let metadataExpiresAt: Date
    public let consentVersion: Int
    public let selectedVideoID: String?
    public let queueIndex: Int
    public let queueCount: Int
    public let upNext: [WidgetTrack]

    public init(
        schemaVersion: Int = WidgetSnapshot.currentSchemaVersion,
        generatedAt: Date,
        metadataExpiresAt: Date,
        consentVersion: Int,
        selectedVideoID: String?,
        queueIndex: Int,
        queueCount: Int,
        upNext: [WidgetTrack]
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.metadataExpiresAt = metadataExpiresAt
        self.consentVersion = consentVersion
        self.selectedVideoID = selectedVideoID
        self.queueIndex = queueIndex
        self.queueCount = queueCount
        self.upNext = Array(upNext.prefix(3))
    }

    public func sanitizedForDisplay(
        now: Date = .now,
        requiredConsentVersion: Int = AppConstants.currentConsentVersion
    ) -> WidgetSnapshot? {
        guard schemaVersion == WidgetSnapshot.currentSchemaVersion,
              consentVersion == requiredConsentVersion,
              metadataExpiresAt > now
        else {
            return nil
        }

        return WidgetSnapshot(
            generatedAt: generatedAt,
            metadataExpiresAt: metadataExpiresAt,
            consentVersion: consentVersion,
            selectedVideoID: selectedVideoID.flatMap {
                YouTubeVideoID.isValid($0) ? $0 : nil
            },
            queueIndex: max(0, queueIndex),
            queueCount: max(0, queueCount),
            upNext: upNext.filter { YouTubeVideoID.isValid($0.videoID) }
        )
    }
}

public enum WidgetSnapshotStoreError: Error, Equatable {
    case appGroupUnavailable
}

public enum WidgetSnapshotStore {
    public static func read() throws -> WidgetSnapshot? {
        try read(from: snapshotURL())
    }

    public static func read(from fileURL: URL) throws -> WidgetSnapshot? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return nil
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(WidgetSnapshot.self, from: Data(contentsOf: fileURL))
    }

    public static func write(_ snapshot: WidgetSnapshot) throws {
        try write(snapshot, to: snapshotURL())
    }

    public static func write(_ snapshot: WidgetSnapshot, to fileURL: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(snapshot)
        try data.write(to: fileURL, options: .atomic)
    }

    public static func remove() throws {
        let url = try snapshotURL()
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    public static func snapshotURL() throws -> URL {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AppConstants.appGroupIdentifier
        ) else {
            throw WidgetSnapshotStoreError.appGroupUnavailable
        }
        return containerURL.appendingPathComponent(AppConstants.widgetSnapshotFilename)
    }
}
