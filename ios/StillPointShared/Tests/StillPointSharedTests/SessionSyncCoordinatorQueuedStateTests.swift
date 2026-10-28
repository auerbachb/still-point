import Foundation
import Testing
@testable import StillPointShared

/// #792: the queue state the completion screen reads to keep the mood off a
/// pending sit, and the session id it may hand on to the detail screen.
/// Split out of `SessionSyncCoordinatorEndNoteClearTests` (#1139).
struct SessionSyncCoordinatorQueuedStateTests {
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

    @Test func testQueuedSessionStateReadsPendingThenSynced() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing)
        _ = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: []
        )

        let pending = try await coordinator.queuedSessionState(clientSessionId: clientSessionId, ownerUserId: owner)
        #expect(pending == .pending)

        var entries = try store.loadEntries()
        entries[0].sessionSynced = true
        entries[0].serverSessionId = "server-9"
        try store.saveEntries(entries)

        let synced = try await coordinator.queuedSessionState(clientSessionId: clientSessionId, ownerUserId: owner)
        #expect(synced == .synced(serverSessionId: "server-9"))
    }

    @Test func testQueuedSessionStateIsNotQueuedForASitThatNeverWentThroughTheQueue() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [
            PendingSessionEntry(
                clientSessionId: clientSessionId,
                ownerUserId: owner,
                request: makeRequest(clientSessionId),
                thoughts: [],
                serverSessionId: "server-\(clientSessionId.uuidString)",
                sessionSynced: true
            ),
        ])
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing)

        let buddySit = try await coordinator.queuedSessionState(clientSessionId: UUID(), ownerUserId: owner)
        #expect(buddySit == .notQueued)
        let otherAccount = try await coordinator.queuedSessionState(clientSessionId: clientSessionId, ownerUserId: "someone-else")
        #expect(otherAccount == .notQueued)
    }

    @Test func testDetailSessionIdNeverHandsOutAPendingSitsProvisionalId() {
        let provisional = UUID().uuidString
        typealias State = SessionSyncCoordinator.QueuedSessionState

        #expect(State.pending.detailSessionId(handedSessionId: provisional) == nil)
        // A sit that synced after the screen was handed its provisional id uses the server's.
        #expect(State.synced(serverSessionId: "server-1").detailSessionId(handedSessionId: provisional) == "server-1")
        // Buddy sits are recorded on the server directly; their handed id is real.
        #expect(State.notQueued.detailSessionId(handedSessionId: "buddy-sit") == "buddy-sit")
        // "Continue without saving" hands over no id at all.
        #expect(State.notQueued.detailSessionId(handedSessionId: "") == nil)
    }
}
