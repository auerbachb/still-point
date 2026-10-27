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

    /// #792: where a sit stands in the queue. The completion screen reads this
    /// instead of guessing from the id it was handed: a pending sit's id is
    /// provisional, and the UI-test backend reuses the client id as the server id.
    public enum QueuedSessionState: Sendable, Equatable {
        /// No entry — the sit never went through the queue (a buddy sit records
        /// itself on the server) or its entry has since been removed.
        case notQueued
        /// Queued, with no server row yet.
        case pending
        /// Created on the server under this id.
        case synced(serverSessionId: String)

        /// The id that session-detail requests (the mood, and a note sent straight
        /// to the server) may use for a sit whose completion screen was handed
        /// `sessionId`. Never the provisional id of a pending sit, which the
        /// server has no row for.
        public func detailSessionId(handedSessionId sessionId: String) -> String? {
            switch self {
            case .synced(let serverSessionId):
                return serverSessionId
            case .notQueued:
                return sessionId.isEmpty ? nil : sessionId
            case .pending:
                return nil
            }
        }
    }

    private let queueStore: OfflineSessionQueueStore
    private let transport: SessionSyncTransport
    // #792: one queue mutation or flush at a time — the actor counterpart of web
    // `withQueueMutation`. An actor re-enters at every `await`, so without this
    // a note edit could land between a flush's upload and the queue update after
    // it, and a clear could reach the server ahead of the note it deletes.
    private var mutationInFlight = false
    private var mutationWaiters: [CheckedContinuation<Void, Never>] = []

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
            .filter { $0.ownerUserId == ownerUserId && $0.awaitsSync }
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

        return try await serialized {
            var entries = try queueStore.loadEntries()
            if let existingIndex = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) {
                let existing = entries[existingIndex]
                guard existing.ownerUserId == ownerUserId else {
                    throw SessionSyncError.ownerMismatch
                }
                if !existing.awaitsSync, let serverId = existing.serverSessionId {
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
    }

    /// Set the end-of-sit note of a queued or already-synced local entry.
    public func replaceEndNote(clientSessionId: UUID, ownerUserId: String, note: String) async throws {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        try await writeEndNote(clientSessionId: clientSessionId, ownerUserId: ownerUserId, note: trimmed)
    }

    /// #792: remove the end-of-sit note of a queued or already-synced local entry.
    public func clearEndNote(clientSessionId: UUID, ownerUserId: String) async throws {
        try await writeEndNote(clientSessionId: clientSessionId, ownerUserId: ownerUserId, note: nil)
    }

    /// Flush pending entries for the signed-in user. Returns how many fully synced.
    @discardableResult
    public func flushPending(ownerUserId: String) async throws -> Int {
        guard !ownerUserId.isEmpty else { return 0 }

        let entries = try queueStore.loadEntries()
        var syncedCount = 0
        for entry in entries where entry.ownerUserId == ownerUserId && entry.awaitsSync {
            // #792: one entry at a time, taking turns with note edits.
            let flushed = try await serialized {
                try await flushEntry(clientSessionId: entry.clientSessionId, ownerUserId: ownerUserId)
            }
            if flushed != nil {
                syncedCount += 1
            }
        }
        return syncedCount
    }

    /// #792: where this sit stands in the queue — see `QueuedSessionState`.
    public func queuedSessionState(clientSessionId: UUID, ownerUserId: String) throws -> QueuedSessionState {
        guard let entry = try queueStore.loadEntries().first(where: {
            $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
        }) else {
            return .notQueued
        }
        if entry.sessionSynced, let serverSessionId = entry.serverSessionId {
            return .synced(serverSessionId: serverSessionId)
        }
        return .pending
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
        entries.removeAll { $0.ownerUserId == ownerUserId && !$0.awaitsSync }
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

    /// Runs `operation` once every earlier serialized operation has finished.
    private func serialized<T>(_ operation: () async throws -> T) async rethrows -> T {
        if mutationInFlight {
            await withCheckedContinuation { mutationWaiters.append($0) }
        } else {
            mutationInFlight = true
        }
        defer {
            if mutationWaiters.isEmpty {
                mutationInFlight = false
            } else {
                // The turn passes straight to the next waiter.
                mutationWaiters.removeFirst().resume()
            }
        }
        return try await operation()
    }

    /// `note` nil clears it. Either way the entry keeps at most one end note and
    /// its in-session thoughts are never touched.
    private func writeEndNote(clientSessionId: UUID, ownerUserId: String, note: String?) async throws {
        guard !ownerUserId.isEmpty else {
            throw SessionSyncError.missingOwnerUserId
        }

        try await serialized {
            var entries = try queueStore.loadEntries()
            guard let index = entries.firstIndex(where: { $0.clientSessionId == clientSessionId }) else {
                throw SessionSyncError.entryNotFound
            }
            guard entries[index].ownerUserId == ownerUserId else {
                throw SessionSyncError.ownerMismatch
            }

            // #753: autosave can run again as the note is edited. Keep one end note
            // and replace its text. A second -1 in the same batch is rejected.
            var thoughts = entries[index].thoughts.filter { $0.timeInSession != -1 }
            if let note {
                thoughts.append(PendingSessionThought(timeInSession: -1, text: note))
            }
            entries[index].thoughts = thoughts
            // #792: a new note replaces the stored one server-side, so only a clear
            // needs the flag — and only once the sit has a server row that could
            // hold a note. Before that, dropping the queued note is the whole clear.
            entries[index].clearCompletionNote = note == nil && entries[index].sessionSynced
            try queueStore.saveEntries(entries)
            _ = try await flushEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId)
        }
    }

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

        let sentClear = entry.clearCompletionNote
        if !entry.thoughts.isEmpty || sentClear {
            let sent = entry.thoughts
            do {
                let batch = BatchThoughtsRequest(
                    sessionId: serverSessionId,
                    dayNumber: entry.request.dayNumber,
                    thoughts: sent.map {
                        BatchThoughtsRequest.ThoughtInput(timeInSession: $0.timeInSession, text: $0.text)
                    },
                    clearCompletionNote: sentClear
                )
                _ = try await transport.batchThoughts(batch)
                var entries = try queueStore.loadEntries()
                guard let index = entries.firstIndex(where: {
                    $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId
                }) else {
                    return Self.sessionDTO(from: entry.request, id: serverSessionId)
                }
                // Only drop what this batch sent. A note replaced while the
                // request was in flight (#753 autosave) stays queued, and a clear
                // asked for after a request that carried none stays set (#792).
                entries[index].thoughts.removeAll { sent.contains($0) }
                if sentClear {
                    entries[index].clearCompletionNote = false
                }
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
            focusCategory: request.focusCategory,
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
            focusCategory: request.focusCategory,
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
