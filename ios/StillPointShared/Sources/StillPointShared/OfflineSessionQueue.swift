import Foundation

/// A thought captured during or after a sit, queued for offline sync (#557).
public struct PendingSessionThought: Codable, Sendable, Equatable {
    public let timeInSession: Int
    public let text: String

    public init(timeInSession: Int, text: String) {
        self.timeInSession = timeInSession
        self.text = text
    }
}

/// Durable local record of a completed sit awaiting server sync (#557).
public struct PendingSessionEntry: Codable, Sendable, Identifiable {
    public var id: UUID { clientSessionId }
    public let clientSessionId: UUID
    public let request: CreateSessionRequest
    public var thoughts: [PendingSessionThought]
    public var serverSessionId: String?
    public var sessionSynced: Bool
    public let enqueuedAt: Date

    public init(
        clientSessionId: UUID,
        request: CreateSessionRequest,
        thoughts: [PendingSessionThought],
        serverSessionId: String? = nil,
        sessionSynced: Bool = false,
        enqueuedAt: Date = Date()
    ) {
        self.clientSessionId = clientSessionId
        self.request = request
        self.thoughts = thoughts
        self.serverSessionId = serverSessionId
        self.sessionSynced = sessionSynced
        self.enqueuedAt = enqueuedAt
    }
}

/// File-backed outbox for offline session writes. Stored separately from SwiftData
/// so the UI-test SwiftData wipe (#276) never drops unsynced sits.
public enum OfflineSessionQueue {
    public static let fileName = "offline-session-queue.json"

    public static func defaultFileURL(fileManager: FileManager = .default) throws -> URL {
        let support = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return support.appendingPathComponent(fileName)
    }

    /// Remove the queue file (UI-test reset only — not part of SwiftData wipe).
    public static func removePersistedQueue(fileManager: FileManager = .default) {
        guard let url = try? defaultFileURL(fileManager: fileManager) else { return }
        try? fileManager.removeItem(at: url)
    }
}

public protocol OfflineSessionQueueStore: Sendable {
    func loadEntries() throws -> [PendingSessionEntry]
    func saveEntries(_ entries: [PendingSessionEntry]) throws
}

public struct FileOfflineSessionQueueStore: OfflineSessionQueueStore {
    private let fileURL: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        fileURL: URL,
        fileManager: FileManager = .default,
        encoder: JSONEncoder? = nil,
        decoder: JSONDecoder? = nil
    ) {
        self.fileURL = fileURL
        self.fileManager = fileManager
        self.encoder = encoder ?? Self.makeEncoder()
        self.decoder = decoder ?? Self.makeDecoder()
    }

    public func loadEntries() throws -> [PendingSessionEntry] {
        guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
        let data = try Data(contentsOf: fileURL)
        guard !data.isEmpty else { return [] }
        return try decoder.decode([PendingSessionEntry].self, from: data)
    }

    public func saveEntries(_ entries: [PendingSessionEntry]) throws {
        let directory = fileURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try encoder.encode(entries)
        try data.write(to: fileURL, options: [.atomic])
    }

    private static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

public final class InMemoryOfflineSessionQueueStore: OfflineSessionQueueStore, @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [PendingSessionEntry]

    public init(entries: [PendingSessionEntry] = []) {
        self.entries = entries
    }

    public func loadEntries() throws -> [PendingSessionEntry] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }

    public func saveEntries(_ entries: [PendingSessionEntry]) throws {
        lock.lock()
        defer { lock.unlock() }
        self.entries = entries
    }
}
