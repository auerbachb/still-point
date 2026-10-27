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
    /// #983: a parked sit stays queued but is not counted, since no flush
    /// sends it again (web `pendingCount`, #978).
    public func pendingCount(ownerUserId: String) async throws -> Int {
        try queueStore.loadEntries()
            .filter { $0.ownerUserId == ownerUserId && $0.awaitsFlush }
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
                    thoughts: Self.withClientThoughtIds(thoughts)
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
        // #983: a failed upload ends only its own sit, so the sits behind it
        // still go up. A parked sit is skipped: it would get the same answer.
        for entry in entries where entry.ownerUserId == ownerUserId && entry.awaitsFlush {
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
        guard let entry = try loadEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId) else {
            return .notQueued
        }
        if entry.sessionSynced, let serverSessionId = entry.serverSessionId {
            return .synced(serverSessionId: serverSessionId)
        }
        return .pending
    }

    /// Resolve the best session id for API calls (server id when known).
    public func resolvedServerSessionId(for clientSessionId: UUID, ownerUserId: String) async throws -> String? {
        try loadEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId)?.serverSessionId
    }

    /// Drop fully-synced entries once the completion flow finishes. #983: a
    /// parked entry is kept as the record of the sit and of why it was turned down.
    public func pruneCompletedEntries(ownerUserId: String) async throws {
        guard !ownerUserId.isEmpty else { return }

        try removeEntries { $0.ownerUserId == ownerUserId && !$0.awaitsSync && $0.parked == nil }
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

        try removeEntries { $0.ownerUserId == ownerUserId && $0.enqueuedAt < boundary }
    }

    // MARK: - Serialization

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

    // MARK: - Queue access

    /// Index of the entry queued under `clientSessionId` for `ownerUserId`.
    private static func entryIndex(
        in entries: [PendingSessionEntry],
        clientSessionId: UUID,
        ownerUserId: String
    ) -> Int? {
        entries.firstIndex { $0.clientSessionId == clientSessionId && $0.ownerUserId == ownerUserId }
    }

    /// The entry queued under `clientSessionId` for `ownerUserId`, freshly read.
    private func loadEntry(clientSessionId: UUID, ownerUserId: String) throws -> PendingSessionEntry? {
        let entries = try queueStore.loadEntries()
        return Self.entryIndex(in: entries, clientSessionId: clientSessionId, ownerUserId: ownerUserId)
            .map { entries[$0] }
    }

    /// Removes every entry matching `shouldRemove`, writing the queue only when
    /// something was removed.
    private func removeEntries(where shouldRemove: (PendingSessionEntry) -> Bool) throws {
        var entries = try queueStore.loadEntries()
        let before = entries.count
        entries.removeAll(where: shouldRemove)
        if entries.count != before {
            try queueStore.saveEntries(entries)
        }
    }

    // MARK: - End note

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
            // #983: a parked sit is never sent again, so a note written to it
            // would only be kept on this device. Say so instead of reporting it saved.
            guard entries[index].parked == nil else {
                throw SessionSyncError.entryParked
            }

            // #753: autosave can run again as the note is edited. Keep one end note
            // and replace its text. A second end note in the same batch is rejected.
            var thoughts = entries[index].thoughts.filter { $0.timeInSession != Self.endNoteTimeInSession }
            if let note {
                thoughts.append(PendingSessionThought(timeInSession: Self.endNoteTimeInSession, text: note))
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

    // MARK: - Flush

    /// Uploads one queued sit: creates its server row if it has none, then sends
    /// its queued thoughts and any pending note clear. Returns the synced session,
    /// or nil when the sit is missing, parked, or an upload failed.
    @discardableResult
    private func flushEntry(clientSessionId: UUID, ownerUserId: String) async throws -> SessionDTO? {
        guard var entry = try loadEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId),
              entry.parked == nil else {
            // #983: sent again, a parked sit would only get the same answer.
            return nil
        }

        if !entry.sessionSynced {
            guard let created = await createServerSession(for: entry) else { return nil }
            entry = created
        }

        guard let serverSessionId = entry.serverSessionId else { return nil }

        entry = try loadEntry(clientSessionId: clientSessionId, ownerUserId: ownerUserId) ?? entry

        if !entry.thoughts.isEmpty || entry.clearCompletionNote {
            guard let uploaded = await uploadThoughts(of: entry, serverSessionId: serverSessionId) else {
                return nil
            }
            entry = uploaded
        }

        return Self.sessionDTO(from: entry.request, id: serverSessionId)
    }

    /// Creates the sit's server row and records its id on the queued entry.
    /// Returns the updated entry, or nil when the entry has since left the queue
    /// or the upload failed (parking the sit if the server turned it down). A
    /// queue read or write that throws here is treated as a failed upload.
    private func createServerSession(for entry: PendingSessionEntry) async -> PendingSessionEntry? {
        let clientSessionId = entry.clientSessionId
        let ownerUserId = entry.ownerUserId
        do {
            let session = try await transport.createSession(entry.request)
            var entries = try queueStore.loadEntries()
            guard let index = Self.entryIndex(
                in: entries, clientSessionId: clientSessionId, ownerUserId: ownerUserId
            ) else {
                return nil
            }
            entries[index].serverSessionId = session.id
            entries[index].sessionSynced = true
            try queueStore.saveEntries(entries)
            return entries[index]
        } catch {
            parkIfRejected(by: error, clientSessionId: clientSessionId, ownerUserId: ownerUserId)
            return nil
        }
    }

    /// Sends the entry's queued thoughts (and its pending note clear) and drops
    /// what was sent from the queue. Returns the entry to build the session from
    /// — the updated one, or `entry` itself if it has since left the queue — or
    /// nil when the upload failed (parking the sit if the server turned it down).
    /// A queue read or write that throws here is treated as a failed upload.
    private func uploadThoughts(
        of entry: PendingSessionEntry,
        serverSessionId: String
    ) async -> PendingSessionEntry? {
        let clientSessionId = entry.clientSessionId
        let ownerUserId = entry.ownerUserId
        let sent = entry.thoughts
        let sentClear = entry.clearCompletionNote
        do {
            let batch = Self.thoughtsBatch(for: entry, serverSessionId: serverSessionId, clearCompletionNote: sentClear)
            _ = try await transport.batchThoughts(batch)
            var entries = try queueStore.loadEntries()
            guard let index = Self.entryIndex(
                in: entries, clientSessionId: clientSessionId, ownerUserId: ownerUserId
            ) else {
                return entry
            }
            // Only drop what this batch sent. A note replaced while the
            // request was in flight (#753 autosave) stays queued, and a clear
            // asked for after a request that carried none stays set (#792).
            // #971: the answer is not read. A replay the server had already
            // stored answers `[]`, and still acknowledges what it sent.
            entries[index].thoughts.removeAll { queued in
                sent.contains { Self.isSameThought($0, queued) }
            }
            if sentClear {
                entries[index].clearCompletionNote = false
            }
            try queueStore.saveEntries(entries)
            return entries[index]
        } catch {
            parkIfRejected(by: error, clientSessionId: clientSessionId, ownerUserId: ownerUserId)
            return nil
        }
    }

    /// #983: keeps the sit, with the answer that turned it down, where no flush
    /// sends it again. Runs in the caller's queue turn, like the rest of
    /// `flushEntry`. A park that cannot be saved leaves the sit queued as before,
    /// so the next flush sends it and gets the answer again.
    private func parkIfRejected(by error: Error, clientSessionId: UUID, ownerUserId: String) {
        guard Self.rejectsTheSit(error), let apiError = error as? APIError else { return }
        guard var entries = try? queueStore.loadEntries(),
              let index = Self.entryIndex(in: entries, clientSessionId: clientSessionId, ownerUserId: ownerUserId)
        else {
            return
        }
        entries[index].parked = PendingSessionParked(status: apiError.status, message: apiError.message)
        try? queueStore.saveEntries(entries)
    }
}

public enum SessionSyncError: Error, Sendable {
    case entryNotFound
    case missingOwnerUserId
    case ownerMismatch
    /// #983: the server turned the sit down for good, so its note cannot reach it.
    case entryParked
}
