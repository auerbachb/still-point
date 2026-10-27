import Foundation
import Testing
@testable import StillPointShared

/// A queue whose reads start throwing once a sit's server row is recorded —
/// between the create and the thought upload — for `failingReads` reads.
private final class FailsReadsAfterCreate: OfflineSessionQueueStore, @unchecked Sendable {
    private let base = InMemoryOfflineSessionQueueStore()
    private let lock = NSLock()
    private var readsToFail = 0
    private let failingReads: Int
    private(set) var failedReads = 0

    init(failingReads: Int) {
        self.failingReads = failingReads
    }

    func loadEntries() throws -> [PendingSessionEntry] {
        lock.lock()
        let fail = readsToFail > 0
        if fail {
            readsToFail -= 1
            failedReads += 1
        }
        lock.unlock()
        if fail { throw CocoaError(.fileReadUnknown) }
        return try base.loadEntries()
    }

    func saveEntries(_ entries: [PendingSessionEntry]) throws {
        let wasSynced = try base.loadEntries().contains(where: \.sessionSynced)
        try base.saveEntries(entries)
        if !wasSynced, entries.contains(where: \.sessionSynced) {
            lock.lock()
            readsToFail = failingReads
            lock.unlock()
        }
    }

    /// The queue as stored, read past the failures.
    func stored() throws -> [PendingSessionEntry] {
        try base.loadEntries()
    }

    /// Lets every later read through.
    func recover() {
        lock.lock()
        readsToFail = 0
        lock.unlock()
    }
}

/// Counts the uploads a flush makes.
private actor CountingServer {
    private(set) var creates = 0
    private(set) var batches: [BatchThoughtsRequest] = []

    nonisolated var transport: SessionSyncTransport {
        SessionSyncTransport(
            createSession: { request in try await self.create(request) },
            batchThoughts: { batch in try await self.batch(batch) }
        )
    }

    private func create(_ request: CreateSessionRequest) -> SessionDTO {
        creates += 1
        return SessionSyncCoordinator.sessionDTO(from: request, id: "server-1092")
    }

    private func batch(_ request: BatchThoughtsRequest) -> [ThoughtDTO] {
        batches.append(request)
        return []
    }
}

/// #1092: a queue read that throws after the sit's server row exists is a failed
/// upload, not a failed save. `saveCompletedSession` returns, the sit stays
/// queued as synced, and the next flush sends its thoughts without a second create.
struct SessionSyncCoordinatorPostCreateReadTests {
    private let owner = "user-test-1092"

    private func makeRequest(_ clientSessionId: UUID) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: 3,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 80,
            thoughtCount: 1,
            mindStateLog: [],
            sessionDate: "2026-10-27",
            clientSessionId: clientSessionId
        )
    }

    /// One failed read is the post-create re-read in `flushEntry`; a queue that
    /// keeps failing also fails the read `saveCompletedSession` makes after it.
    @Test(arguments: [1, Int.max])
    func testAQueueReadThatThrowsAfterTheCreateLeavesTheSitSyncedAndTheSaveReturns(failingReads: Int) async throws {
        let store = FailsReadsAfterCreate(failingReads: failingReads)
        let server = CountingServer()
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: server.transport)
        let clientSessionId = UUID()

        let saved = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: [PendingSessionThought(timeInSession: 12, text: "rain")]
        )

        #expect(store.failedReads >= 1)
        #expect(saved.isPendingSync)
        let creates = await server.creates
        #expect(creates == 1)
        let batchesBeforeFlush = await server.batches
        #expect(batchesBeforeFlush.isEmpty)
        let queued = try #require(store.stored().first)
        #expect(queued.sessionSynced)
        #expect(queued.serverSessionId == "server-1092")
        #expect(queued.thoughts.map(\.text) == ["rain"])

        store.recover()
        let flushed = try await coordinator.flushPending(ownerUserId: owner)

        #expect(flushed == 1)
        let createsAfterFlush = await server.creates
        #expect(createsAfterFlush == 1)
        let batches = await server.batches
        #expect(batches.map(\.sessionId) == ["server-1092"])
        #expect(batches.first?.thoughts.map(\.text) == ["rain"])
        #expect(try store.stored().first?.thoughts == [])
    }

    /// With no thoughts queued, nothing is left to upload once the server row
    /// exists, so a failed re-read still returns the synced session and its
    /// server id instead of a provisional, pending one.
    @Test(arguments: [1, Int.max])
    func testAQueueReadThatThrowsAfterTheCreateOfASitWithNoThoughtsReturnsItSynced(failingReads: Int) async throws {
        let store = FailsReadsAfterCreate(failingReads: failingReads)
        let server = CountingServer()
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: server.transport)
        let clientSessionId = UUID()

        let saved = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: []
        )

        #expect(store.failedReads >= 1)
        #expect(!saved.isPendingSync)
        #expect(saved.session.id == "server-1092")
        let creates = await server.creates
        #expect(creates == 1)
        let batches = await server.batches
        #expect(batches.isEmpty)
    }
}
