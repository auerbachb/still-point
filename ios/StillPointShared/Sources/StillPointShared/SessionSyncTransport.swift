import Foundation

/// Network hooks for offline session sync — injectable for unit tests (#557).
public struct SessionSyncTransport: Sendable {
    public var createSession: @Sendable (CreateSessionRequest) async throws -> SessionDTO
    public var batchThoughts: @Sendable (BatchThoughtsRequest) async throws -> [ThoughtDTO]

    public init(
        createSession: @escaping @Sendable (CreateSessionRequest) async throws -> SessionDTO,
        batchThoughts: @escaping @Sendable (BatchThoughtsRequest) async throws -> [ThoughtDTO]
    ) {
        self.createSession = createSession
        self.batchThoughts = batchThoughts
    }

    public static func live(client: APIClient = .shared) -> SessionSyncTransport {
        SessionSyncTransport(
            createSession: { try await client.createSession($0) },
            batchThoughts: { try await client.batchThoughts($0) }
        )
    }

    public static var alwaysFailing: SessionSyncTransport {
        SessionSyncTransport(
            createSession: { _ in throw URLError(.notConnectedToInternet) },
            batchThoughts: { _ in throw URLError(.notConnectedToInternet) }
        )
    }
}
