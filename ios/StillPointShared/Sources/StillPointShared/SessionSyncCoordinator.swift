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
    private let transport: SessionSyncTransport

    public init(
        queueStore: OfflineSessionQueueStore? = nil,
        transport: SessionSyncTransport = .live()
    ) {
        if let queueStore {
            self.queueStore = queueStore
        } else if let url = try? OfflineSessionQueue.defaultFileURL() {
            self.queueStore = FileOfflineSessionQueueStore(fileURL: url)
        } else {
            self.queueStore = InMemoryOfflineSessionQueueStore()
        }
        self.transport = transport
    }

    /// Number of sits still waiting for server sync for the signed-in user.
    public func pendingCount(ownerUserId: String) async throws -> Int {
        try queueStore.loadEntries()
            .filter { $0.ownerUserId == ownerUserId && (!$0.sessionSynced || !$0.thoughts.isEmpty) }
            .count
    }

    /// Local-first save: enqueue durably, attempt immediate sync, return a session DTO either way.
    public func saveCompletedSession(
        request: CreateSessionRequest,
        clientSessionId: UUID,
        ownerUserId: String,
        thoughts: [PendingSessionThought]
    ) async throws -> SaveResult {
        guard !ownerUserId.isEmpty else {
            throw SessionSyncError.missingOwnerUserId
        }

        var entries = try queueStore.loadEntries()
        if let existingIndex = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) {
            let existing = entries[existingIndex]
            guard existing.ownerUserId == ownerUserId else {
                throw SessionSyncError.ownerMismatch
            }
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
                ownerUserId: ownerUserId,
                request: requestWithId,
                thoughts: thoughts
            ))
            try queueStore.saveEntries(entries)
        }

        if let synced = try await flushEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId) {
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
    public func appendEndNote(clientSessionId: UUID, ownerUserId: String, note: String) async throws {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard !ownerUserId.isEmpty else {
            throw SessionSyncError.missingOwnerUserId
        }

        var entries = try queueStore.loadEntries()
        guard let index = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) else {
            throw SessionSyncError.entryNotFound
        }
        guard entries[index].ownerUserId == ownerUserId else {
            throw SessionSyncError.ownerMismatch
        }

        entries[index].thoughts.append(PendingSessionThought(timeInSession: -1, text: trimmed))
        try queueStore.saveEntries(entries)
        _ = try await flushEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId)
    }

    /// Flush pending entries for the signed-in user. Returns how many fully synced.
    @discardableResult
    public func flushPending(ownerUserId: String) async throws -> Int {
        guard !ownerUserId.isEmpty else { return 0 }

        let entries = try queueStore.loadEntries()
        var syncedCount = 0
        for entry in entries where entry.ownerUserId == ownerUserId && (!entry.sessionSynced || !entry.thoughts.isEmpty) {
            if try await flushEntry(clientSessionId: entry.clientSessionId, ownerUserId: ownerUserId) != nil {
                syncedCount += 1
            }
        }
        return syncedCount
    }

    /// Resolve the best session id for API calls (server id when known).
    public func resolvedServerSessionId(for clientSessionId: UUID, ownerUserId: String) async throws -> String? {
        let entry = try queueStore.loadEntries().first {
            $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
        }
        return entry?.serverSessionId
    }

    /// Drop fully-synced entries once the completion flow finishes.
    public func pruneCompletedEntries(ownerUserId: String) async throws {
        guard !ownerUserId.isEmpty else { return }

        var entries = try queueStore.loadEntries()
        let before = entries.count
        entries.removeAll { $0.ownerUserId == ownerUserId && $0.sessionSynced && $0.thoughts.isEmpty }
        if entries.count != before {
            try queueStore.saveEntries(entries)
        }
    }

    /// Remove the signed-out account's queued entries (logout / account switch).
    ///
    /// Owner-scoped rather than a blanket wipe. `didLogout()` schedules this after
    /// tearing the session down and routing to `.auth`, so the user can sign in —
    /// and the next account can save a sit — while this is still pending. A
    /// `saveEntries([])` here would delete entries that the *new* login had just
    /// enqueued; scoping the delete to the account that signed out makes the
    /// ordering irrelevant instead of merely unlikely. Mirrors
    /// `flushPending(ownerUserId:)` and `pruneCompletedEntries(ownerUserId:)`.
    ///
    /// Scoping by owner alone is not enough, because signing back in as the *same*
    /// account reuses the same owner id — so a sit saved after the new sign-in would
    /// still match. This coordinator is an actor, so a cleanup scheduled at logout
    /// can sit waiting on actor isolation while an in-flight `flushPending` blocks
    /// on a slow network, which is what makes that window wide enough to matter. The
    /// boundary confines the delete to rows that already existed when logout began.
    ///
    /// - Parameters:
    ///   - ownerUserId: the account that signed out. Required rather than defaulted
    ///     so a new call site cannot fall back to erasing the whole queue. Empty is
    ///     a no-op: legacy entries decoded without an owner cannot be attributed to
    ///     the account signing out, and deleting unattributable rows is the hazard
    ///     this scoping exists to prevent.
    ///   - boundary: the moment logout began. Only entries enqueued strictly before
    ///     it are removed, so anything the next sign-in saves survives regardless of
    ///     when this cleanup actually runs.
    public func clearQueue(ownerUserId: String, enqueuedBefore boundary: Date) async throws {
        guard !ownerUserId.isEmpty else { return }

        var entries = try queueStore.loadEntries()
        let before = entries.count
        entries.removeAll { $0.ownerUserId == ownerUserId && $0.enqueuedAt < boundary }
        if entries.count != before {
            try queueStore.saveEntries(entries)
        }
    }

    // MARK: - Private

    @discardableResult
    private func flushEntry(clientSessionId: UUID, ownerUserId: String) async throws -> SessionDTO? {
        guard var entry = try queueStore.loadEntries().first(where: {
            $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
        }) else {
            return nil
        }

        if !entry.sessionSynced {
            do {
                let session = try await transport.createSession(entry.request)
                var entries = try queueStore.loadEntries()
                guard let index = entries.firstIndex(where: {
                    $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
                }) else {
                    return nil
                }
                entries[index].serverSessionId = session.id
                entries[index].sessionSynced = true
                try queueStore.saveEntries(entries)
                entry = entries[index]
            } catch {
                return nil
            }
        }

        guard let serverSessionId = entry.serverSessionId else { return nil }

        entry = try queueStore.loadEntries().first(where: {
            $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
        }) ?? entry

        if !entry.thoughts.isEmpty {
            do {
                let batch = BatchThoughtsRequest(
                    sessionId: serverSessionId,
                    dayNumber: entry.request.dayNumber,
                    thoughts: entry.thoughts.map {
                        BatchThoughtsRequest.ThoughtInput(timeInSession: $0.timeInSession, text: $0.text)
                    }
                )
                _ = try await transport.batchThoughts(batch)
                var entries = try queueStore.loadEntries()
                guard let index = entries.firstIndex(where: {
                    $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
                }) else {
                    return Self.sessionDTO(from: entry.request, id: serverSessionId)
                }
                entries[index].thoughts = []
                try queueStore.saveEntries(entries)
                entry = entries[index]
            } catch {
                return nil
            }
        }

        return Self.sessionDTO(from: entry.request, id: serverSessionId)
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
            clientSessionId: clientSessionId,
            ambientSoundSummary: request.ambientSoundSummary
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
            track: request.track,
            ambientSoundSummary: request.ambientSoundSummary
        )
    }
}

public enum SessionSyncError: Error, Sendable {
    case entryNotFound
    case missingOwnerUserId
    case ownerMismatch
}
