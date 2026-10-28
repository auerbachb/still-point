import Foundation
import Testing
@testable import StillPointShared

/// Collects every batch a transport is handed.
private actor BatchRecorder {
    private(set) var batches: [BatchThoughtsRequest] = []
    private(set) var inFlight = 0
    private(set) var overlapped = false

    /// Returns the batch's 1-based position.
    func begin(_ batch: BatchThoughtsRequest) -> Int {
        if inFlight > 0 { overlapped = true }
        inFlight += 1
        batches.append(batch)
        return batches.count
    }

    func end() {
        inFlight -= 1
    }
}

/// #792: clearing a completion note through the offline queue. The queue state
/// the completion screen reads lives in `SessionSyncCoordinatorQueuedStateTests`.
struct SessionSyncCoordinatorEndNoteClearTests {
    private let owner = "user-test-792"

    private func makeRequest(_ clientSessionId: UUID) -> CreateSessionRequest {
        QueuedSitFixtures.request(
            dayNumber: 4,
            clearPercent: 90,
            thoughtCount: 1,
            sessionDate: "2026-10-26",
            clientSessionId: clientSessionId
        )
    }

    /// A sit that already has a server row, with these thoughts still queued.
    private func syncedEntry(
        _ clientSessionId: UUID,
        thoughts: [PendingSessionThought] = []
    ) -> PendingSessionEntry {
        PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            request: makeRequest(clientSessionId),
            thoughts: thoughts,
            serverSessionId: "server-\(clientSessionId.uuidString)",
            sessionSynced: true
        )
    }

    private func recordingTransport(_ recorder: BatchRecorder) -> SessionSyncTransport {
        SessionSyncTransport(
            createSession: { _ in throw URLError(.notConnectedToInternet) },
            batchThoughts: { batch in
                _ = await recorder.begin(batch)
                await recorder.end()
                return []
            }
        )
    }

    // MARK: - Clear and replace

    @Test func testClearBeforeSyncDropsTheQueuedNoteAndAsksTheServerForNothing() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing)
        let clientSessionId = UUID()
        _ = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: [PendingSessionThought(timeInSession: 12, text: "mid-sit")]
        )
        try await coordinator.replaceEndNote(clientSessionId: clientSessionId, ownerUserId: owner, note: "offline note")

        try await coordinator.clearEndNote(clientSessionId: clientSessionId, ownerUserId: owner)

        let entry = try #require(store.loadEntries().first)
        // #971: the in-session thought keeps the id it was queued with.
        let midSitId = try #require(entry.thoughts.first?.clientThoughtId)
        #expect(entry.thoughts == [PendingSessionThought(timeInSession: 12, text: "mid-sit", clientThoughtId: midSitId)])
        // No server row yet, so there is no stored note to delete.
        #expect(!entry.clearCompletionNote)
    }

    @Test func testClearAfterSyncSendsTheFlagToTheServerSessionThenResetsIt() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [syncedEntry(clientSessionId)])
        let recorder = BatchRecorder()
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: recordingTransport(recorder))

        try await coordinator.clearEndNote(clientSessionId: clientSessionId, ownerUserId: owner)

        let batches = await recorder.batches
        #expect(batches.count == 1)
        #expect(batches.first?.sessionId == "server-\(clientSessionId.uuidString)")
        #expect(batches.first?.dayNumber == 4)
        #expect(batches.first?.thoughts.count == 0)
        #expect(batches.first?.clearCompletionNote == true)
        let entry = try #require(store.loadEntries().first)
        #expect(!entry.clearCompletionNote)
    }

    @Test func testAnUnsentClearStaysQueuedCountsAsPendingAndSurvivesPruning() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [
            syncedEntry(clientSessionId, thoughts: [PendingSessionThought(timeInSession: -1, text: "saved note")]),
        ])
        let offline = SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing)

        try await offline.clearEndNote(clientSessionId: clientSessionId, ownerUserId: owner)
        try await offline.pruneCompletedEntries(ownerUserId: owner)

        let entry = try #require(store.loadEntries().first)
        #expect(entry.thoughts.isEmpty)
        #expect(entry.clearCompletionNote)
        let pendingWhileOffline = try await offline.pendingCount(ownerUserId: owner)
        #expect(pendingWhileOffline == 1)

        let recorder = BatchRecorder()
        let online = SessionSyncCoordinator(queueStore: store, transport: recordingTransport(recorder))
        let flushed = try await online.flushPending(ownerUserId: owner)
        #expect(flushed == 1)
        let sentFlags = await recorder.batches.map(\.clearCompletionNote)
        #expect(sentFlags == [true])
        let pendingAfterFlush = try await online.pendingCount(ownerUserId: owner)
        #expect(pendingAfterFlush == 0)
    }

    @Test func testReplacingAfterAQueuedClearSendsTheNewNoteWithoutTheFlag() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [syncedEntry(clientSessionId)])
        let offline = SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing)
        try await offline.clearEndNote(clientSessionId: clientSessionId, ownerUserId: owner)
        try await offline.replaceEndNote(clientSessionId: clientSessionId, ownerUserId: owner, note: "second thoughts")

        let recorder = BatchRecorder()
        try await SessionSyncCoordinator(queueStore: store, transport: recordingTransport(recorder))
            .flushPending(ownerUserId: owner)

        // The server replaces the stored note on its own; no flag needed.
        let batches = await recorder.batches
        #expect(batches.count == 1)
        #expect(batches.first?.clearCompletionNote == nil)
        #expect(batches.first?.thoughts.map(\.text) == ["second thoughts"])
    }

    @Test func testClearOnAnUnknownSitThrowsEntryNotFound() async {
        let coordinator = SessionSyncCoordinator(queueStore: InMemoryOfflineSessionQueueStore(), transport: .alwaysFailing)

        do {
            try await coordinator.clearEndNote(clientSessionId: UUID(), ownerUserId: owner)
            Issue.record("expected entryNotFound")
        } catch SessionSyncError.entryNotFound {
            // expected
        } catch {
            Issue.record("unexpected error \(error)")
        }
    }

    // MARK: - Uploads in flight

    /// Another writer clears the note while this flush's upload of it is on the
    /// wire. The acknowledgement must not erase that newer clear.
    @Test func testAClearAskedForWhileAnUploadIsInFlightOutlivesItsAcknowledgement() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [
            syncedEntry(clientSessionId, thoughts: [PendingSessionThought(timeInSession: -1, text: "first draft")]),
        ])
        let transport = SessionSyncTransport(
            createSession: { _ in throw URLError(.notConnectedToInternet) },
            batchThoughts: { _ in
                var entries = try store.loadEntries()
                entries[0].thoughts = []
                entries[0].clearCompletionNote = true
                try store.saveEntries(entries)
                return []
            }
        )

        try await SessionSyncCoordinator(queueStore: store, transport: transport).flushPending(ownerUserId: owner)

        let entry = try #require(store.loadEntries().first)
        #expect(entry.clearCompletionNote)
    }

    /// The coordinator re-enters at every `await`, so without serialization a
    /// clear would rewrite the queue and go out while the upload of the note it
    /// deletes is still unacknowledged — and could reach the server first.
    @Test func testFlushPendingHoldsAClearUntilTheUploadAheadOfItIsAcknowledged() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [
            syncedEntry(clientSessionId, thoughts: [PendingSessionThought(timeInSession: -1, text: "first draft")]),
        ])
        let recorder = BatchRecorder()
        let (started, markStarted) = AsyncStream<Void>.makeStream()
        let (released, release) = AsyncStream<Void>.makeStream()
        let transport = SessionSyncTransport(
            createSession: { _ in throw URLError(.notConnectedToInternet) },
            batchThoughts: { batch in
                if await recorder.begin(batch) == 1 {
                    markStarted.yield()
                    for await _ in released { break }
                }
                await recorder.end()
                return []
            }
        )
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: transport)
        let owner = self.owner

        let flushing = Task { try await coordinator.flushPending(ownerUserId: owner) }
        for await _ in started { break }
        let clearing = Task { try await coordinator.clearEndNote(clientSessionId: clientSessionId, ownerUserId: owner) }
        // Every chance for the clear to run ahead of the acknowledgement.
        for _ in 0..<50 { await Task.yield() }

        let queuedDuringUpload = try #require(store.loadEntries().first).thoughts
        #expect(queuedDuringUpload == [PendingSessionThought(timeInSession: -1, text: "first draft")])
        let sentDuringUpload = await recorder.batches.count
        #expect(sentDuringUpload == 1)

        release.yield()
        _ = try await flushing.value
        try await clearing.value

        let overlapped = await recorder.overlapped
        #expect(!overlapped, "the clear went out while the note upload was still unacknowledged")
        let sentFlags = await recorder.batches.map(\.clearCompletionNote)
        #expect(sentFlags == [nil, true])
        let entry = try #require(store.loadEntries().first)
        #expect(entry.thoughts.isEmpty)
        #expect(!entry.clearCompletionNote)
    }

    // MARK: - Persistence and wire format

    @Test func testAnEntrySavedBeforeTheClearFlagExistedDecodesWithoutOne() throws {
        let clientSessionId = UUID()
        var entry = syncedEntry(clientSessionId)
        entry.clearCompletionNote = true
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        var object = try #require(JSONSerialization.jsonObject(with: encoder.encode(entry)) as? [String: Any])
        #expect((object["clearCompletionNote"] as? Bool) == true)
        object.removeValue(forKey: "clearCompletionNote")

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let legacy = try decoder.decode(
            PendingSessionEntry.self,
            from: JSONSerialization.data(withJSONObject: object)
        )

        #expect(!legacy.clearCompletionNote)
        #expect(legacy.serverSessionId == "server-\(clientSessionId.uuidString)")
    }

    @Test func testBatchThoughtsRequestSendsTheClearKeyOnlyWhenSet() throws {
        let plain = BatchThoughtsRequest(
            sessionId: "s1",
            dayNumber: 2,
            thoughts: [BatchThoughtsRequest.ThoughtInput(timeInSession: -1, text: "note")]
        )
        let plainJSON = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(plain)) as? [String: Any])
        #expect(plainJSON["clearCompletionNote"] == nil)
        #expect(Set(plainJSON.keys) == ["sessionId", "dayNumber", "thoughts"])

        let clear = BatchThoughtsRequest(sessionId: "s1", dayNumber: 2, thoughts: [], clearCompletionNote: true)
        let clearJSON = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(clear)) as? [String: Any])
        #expect((clearJSON["clearCompletionNote"] as? Bool) == true)
        #expect((clearJSON["thoughts"] as? [Any])?.count == 0)
    }
}
