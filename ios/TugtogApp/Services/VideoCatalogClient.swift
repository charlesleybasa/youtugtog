import Foundation

protocol VideoCatalogClient: Sendable {
    func search(query: String, limit: Int) async throws -> VideoItemsResponse
    func videos(ids: [String]) async throws -> VideoItemsResponse
}

enum VideoCatalogError: LocalizedError, Equatable, Sendable {
    case invalidQuery
    case invalidVideoID
    case invalidResponse
    case offline
    case server(code: String, message: String, retryAfterSeconds: Int?)

    var errorDescription: String? {
        switch self {
        case .invalidQuery:
            return "Enter at least two characters to search."
        case .invalidVideoID:
            return "That doesn’t look like a valid YouTube link."
        case .invalidResponse:
            return "Tugtog received an unexpected response. Please try again."
        case .offline:
            return "You appear to be offline. Check your connection and try again."
        case let .server(_, message, retryAfterSeconds):
            if let retryAfterSeconds {
                return "\(message) Try again in \(retryAfterSeconds) seconds."
            }
            return message
        }
    }
}

actor YouTubeAPIClient: VideoCatalogClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(baseURL: URL = AppConstants.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func search(query: String, limit: Int = 8) async throws -> VideoItemsResponse {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...100).contains(normalizedQuery.count) else {
            throw VideoCatalogError.invalidQuery
        }

        return try await request(
            path: "/api/search",
            queryItems: [
                URLQueryItem(name: "q", value: normalizedQuery),
                URLQueryItem(name: "limit", value: String(min(max(limit, 1), 8)))
            ]
        )
    }

    func videos(ids: [String]) async throws -> VideoItemsResponse {
        let uniqueIDs = Array(NSOrderedSet(array: ids).compactMap { $0 as? String }).prefix(50)
        guard !uniqueIDs.isEmpty,
              uniqueIDs.allSatisfy(YouTubeVideoID.isValid)
        else {
            throw VideoCatalogError.invalidVideoID
        }

        return try await request(
            path: "/api/videos",
            queryItems: [URLQueryItem(name: "ids", value: uniqueIDs.joined(separator: ","))]
        )
    }

    private func request(path: String, queryItems: [URLQueryItem]) async throws -> VideoItemsResponse {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else {
            throw VideoCatalogError.invalidResponse
        }
        components.queryItems = queryItems

        guard let url = components.url else {
            throw VideoCatalogError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where [
            .notConnectedToInternet,
            .networkConnectionLost,
            .cannotFindHost,
            .cannotConnectToHost
        ].contains(error.code) {
            throw VideoCatalogError.offline
        } catch {
            throw error
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw VideoCatalogError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
                throw VideoCatalogError.server(
                    code: envelope.error.code,
                    message: envelope.error.message,
                    retryAfterSeconds: envelope.error.retryAfterSeconds
                )
            }
            throw VideoCatalogError.server(
                code: "HTTP_\(httpResponse.statusCode)",
                message: "Tugtog couldn’t reach the video catalog.",
                retryAfterSeconds: nil
            )
        }

        do {
            return try decoder.decode(VideoItemsResponse.self, from: data)
        } catch {
            throw VideoCatalogError.invalidResponse
        }
    }
}
