import Foundation

/// Persists completed sits locally first, then syncs to the server on reconnect (#557).
public actor SessionSyncCoordinator {
    public static let shared = SessionSyncCoordinator()

    public struct SaveResult: Sendable {
        public let session: SessionDTO
        public let isPendingSync: Bool

        public init(session: SessionDTO, isPendingSync: Bool) {
            self.session = session
            self.isPendingSync = isPendingSync
        }
    }

    private let queueStore: OfflineSessionQueueStore
    private let apiClient: APIClient

    public init(
        queueStore: OfflineSessionQueueStore? = nil,
        apiClient: APIClient = .shared
    ) {
        if let queueStore {
            self.queueStore = queueStore
        } else if let url = try? OfflineSessionQueue.defaultFileURL() {
            self.queueStore = FileOfflineSessionQueueStore(fileURL: url)
        } else {
            self.queueStore = InMemoryOfflineSessionQueueStore()
        }
        self.apiClient = apiClient
    }

    /// Number of sits still waiting for server sync.
    public func pendingCount() async throws -> Int {
        try queueStore.loadEntries().filter { !$0.sessionSynced || !$0.thoughts.isEmpty }.count
    }

    /// Local-first save: enqueue durably, attempt immediate sync, return a session DTO either way.
    public func saveCompletedSession(
        request: CreateSessionRequest,
        clientSessionId: UUID,
        thoughts: [PendingSessionThought]
    ) async throws -> SaveResult {
        var entries = try queueStore.loadEntries()
        if let existingIndex = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) {
            let existing = entries[existingIndex]
            if existing.sessionSynced, existing.thoughts.isEmpty, let serverId = existing.serverSessionId {
                return SaveResult(
                    session: Self.sessionDTO(from: existing.request, id: serverId),
                    isPendingSync: false
                )
            }
        } else {
            let requestWithId = Self.requestWithClientId(request, clientSessionId: clientSessionId)
            entries.append(PendingSessionEntry(
                clientSessionId: clientSessionId,
                request: requestWithId,
                thoughts: thoughts
            ))
            try queueStore.saveEntries(entries)
        }

        if let synced = try await flushEntry(clientSessionId: clientSessionId) {
            return SaveResult(session: synced, isPendingSync: false)
        }

        let entry = try queueStore.loadEntries().first { $0.clientSessionId == clientSessionId }
        let provisionalRequest = entry?.request ?? Self.requestWithClientId(request, clientSessionId: clientSessionId)
        return SaveResult(
            session: Self.provisionalSessionDTO(from: provisionalRequest, clientSessionId: clientSessionId),
            isPendingSync: true
        )
    }

    /// Append an end-of-sit note to a queued or already-synced local entry.
    public func appendEndNote(clientSessionId: UUID, note: String) async throws {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        var entries = try queueStore.loadEntries()
        guard let index = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) else {
            throw SessionSyncError.entryNotFound
        }

        entries[index].thoughts.append(PendingSessionThought(timeInSession: -1, text: trimmed))
        try queueStore.saveEntries(entries)
        _ = try await flushEntry(clientSessionId: clientSessionId)
    }

    /// Flush all pending entries. Returns how many fully synced.
    @discardableResult
    public func flushPending() async throws -> Int {
        let entries = try queueStore.loadEntries()
        var syncedCount = 0
        for entry in entries where !entry.sessionSynced || !entry.thoughts.isEmpty {
            if try await flushEntry(clientSessionId: entry.clientSessionId) != nil {
                syncedCount += 1
            }
        }
        return syncedCount
    }

    /// Resolve the best session id for API calls (server id when known).
    public func resolvedServerSessionId(for clientSessionId: UUID) async throws -> String? {
        let entry = try queueStore.loadEntries().first { $0.clientSessionId == clientSessionId }
        return entry?.serverSessionId
    }

    // MARK: - Private

    @discardableResult
    private func flushEntry(clientSessionId: UUID) async throws -> SessionDTO? {
        var entries = try queueStore.loadEntries()
        guard let index = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) else {
            return nil
        }

        var entry = entries[index]

        if !entry.sessionSynced {
            do {
                let session = try await apiClient.createSession(entry.request)
                entry.serverSessionId = session.id
                entry.sessionSynced = true
                entries[index] = entry
                try queueStore.saveEntries(entries)
            } catch {
                return nil
            }
        }

        guard let serverSessionId = entry.serverSessionId else { return nil }

        if !entry.thoughts.isEmpty {
            do {
                let batch = BatchThoughtsRequest(
                    sessionId: serverSessionId,
                    dayNumber: entry.request.dayNumber,
                    thoughts: entry.thoughts.map {
                        BatchThoughtsRequest.ThoughtInput(timeInSession: $0.timeInSession, text: $0.text)
                    }
                )
                _ = try await apiClient.batchThoughts(batch)
                entry.thoughts = []
                entries[index] = entry
                try queueStore.saveEntries(entries)
            } catch {
                return nil
            }
        }

        return Self.sessionDTO(from: entry.request, id: serverSessionId)
    }

    /// Drop fully-synced entries once the completion flow finishes.
    public func pruneCompletedEntries() async throws {
        var entries = try queueStore.loadEntries()
        let before = entries.count
        entries.removeAll { $0.sessionSynced && $0.thoughts.isEmpty }
        if entries.count != before {
            try queueStore.saveEntries(entries)
        }
    }

    private static func requestWithClientId(
        _ request: CreateSessionRequest,
        clientSessionId: UUID
    ) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: request.dayNumber,
            sessionType: request.sessionType,
            duration: request.duration,
            bonusSeconds: request.bonusSeconds,
            completed: request.completed,
            actualTime: request.actualTime,
            clearPercent: request.clearPercent,
            thoughtCount: request.thoughtCount,
            mindStateLog: request.mindStateLog,
            attentionLog: request.attentionLog,
            sessionDate: request.sessionDate,
            breathCount: request.breathCount,
            track: request.track,
            clientSessionId: clientSessionId
        )
    }

    static func provisionalSessionDTO(
        from request: CreateSessionRequest,
        clientSessionId: UUID
    ) -> SessionDTO {
        sessionDTO(from: request, id: clientSessionId.uuidString)
    }

    static func sessionDTO(from request: CreateSessionRequest, id: String) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: request.dayNumber,
            sessionType: request.sessionType,
            duration: request.duration,
            bonusSeconds: request.bonusSeconds == 0 ? nil : request.bonusSeconds,
            completed: request.completed,
            actualTime: request.actualTime,
            clearPercent: request.clearPercent,
            thoughtCount: request.thoughtCount,
            mindStateLog: request.mindStateLog,
            attentionLog: request.attentionLog,
            sessionDate: request.sessionDate,
            createdAt: nil,
            buddySessionId: nil,
            breathCount: request.breathCount,
            track: request.track
        )
    }
}

public enum SessionSyncError: Error, Sendable {
    case entryNotFound
}
