import Foundation

public struct VideoSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let channelTitle: String
    public let thumbnailURL: URL
    public let durationSeconds: Int
    public let embeddable: Bool
    public let madeForKids: Bool
    public let refreshedAt: Date

    public init(
        id: String,
        title: String,
        channelTitle: String,
        thumbnailURL: URL,
        durationSeconds: Int,
        embeddable: Bool,
        madeForKids: Bool,
        refreshedAt: Date
    ) {
        self.id = id
        self.title = title
        self.channelTitle = channelTitle
        self.thumbnailURL = thumbnailURL
        self.durationSeconds = durationSeconds
        self.embeddable = embeddable
        self.madeForKids = madeForKids
        self.refreshedAt = refreshedAt
    }

    public func metadataIsFresh(at date: Date = .now) -> Bool {
        refreshedAt.addingTimeInterval(AppConstants.metadataLifetime) > date
    }
}

public struct VideoItemsResponse: Codable, Sendable {
    public let items: [VideoSummary]
    public let rejectedIds: [String]?

    public init(items: [VideoSummary], rejectedIds: [String]? = nil) {
        self.items = items
        self.rejectedIds = rejectedIds
    }
}

public struct APIErrorEnvelope: Codable, Sendable {
    public struct Payload: Codable, Sendable {
        public let code: String
        public let message: String
        public let retryAfterSeconds: Int?
    }

    public let error: Payload
}
