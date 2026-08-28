import XCTest
@testable import StillPointShared

/// #665: logout's queue cleanup must not take a later sign-in's sits with it.
///
/// `didLogout()` tears the session down and routes to `.auth` synchronously, then
/// schedules the queue cleanup. The user can therefore sign in — and save a sit —
/// before that cleanup runs, and because the coordinator is an actor the cleanup
/// can be stuck waiting on an in-flight `flushPending` the whole time. These cover
/// that ordering for both the next-account and same-account cases.
final class SessionSyncCoordinatorTests: XCTestCase {
    private func makeEntry(owner: String, enqueuedAt: Date = Date()) -> PendingSessionEntry {
        let clientSessionId = UUID()
        return PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            request: CreateSessionRequest(
                dayNumber: 1,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: [],
                sessionDate: "2026-08-27",
                clientSessionId: clientSessionId
            ),
            thoughts: [],
            enqueuedAt: enqueuedAt
        )
    }

    private func makeCoordinator(
        _ entries: [PendingSessionEntry]
    ) -> (SessionSyncCoordinator, InMemoryOfflineSessionQueueStore) {
        let store = InMemoryOfflineSessionQueueStore(entries: entries)
        return (SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing), store)
    }

    private let logoutBoundary = Date()
    private var beforeLogout: Date { logoutBoundary.addingTimeInterval(-60) }
    private var afterLogout: Date { logoutBoundary.addingTimeInterval(60) }

    /// Sign out as A, sign in as B, B saves a sit, then A's deferred cleanup lands.
    func testClearQueueKeepsEntriesBelongingToTheNextAccount() async throws {
        let signedOut = makeEntry(owner: "user-a", enqueuedAt: beforeLogout)
        let nextLogin = makeEntry(owner: "user-b", enqueuedAt: afterLogout)
        let (coordinator, store) = makeCoordinator([signedOut, nextLogin])

        try await coordinator.clearQueue(ownerUserId: "user-a", enqueuedBefore: logoutBoundary)

        let remaining = try store.loadEntries()
        XCTAssertEqual(remaining.count, 1)
        XCTAssertEqual(remaining.first?.clientSessionId, nextLogin.clientSessionId)
    }

    /// The same-account ordering: sign out as A, sign back in as A, save a sit, then
    /// the deferred cleanup lands. Owner scoping alone would delete the new sit
    /// because the owner id is identical — the logout boundary is what saves it.
    func testClearQueueKeepsSitsSavedAfterSigningBackInAsTheSameAccount() async throws {
        let staleSit = makeEntry(owner: "user-a", enqueuedAt: beforeLogout)
        let sitAfterSigningBackIn = makeEntry(owner: "user-a", enqueuedAt: afterLogout)
        let (coordinator, store) = makeCoordinator([staleSit, sitAfterSigningBackIn])

        try await coordinator.clearQueue(ownerUserId: "user-a", enqueuedBefore: logoutBoundary)

        let remaining = try store.loadEntries()
        XCTAssertEqual(remaining.count, 1)
        XCTAssertEqual(remaining.first?.clientSessionId, sitAfterSigningBackIn.clientSessionId)
    }

    func testClearQueueRemovesEveryPriorSitForTheSignedOutAccount() async throws {
        let (coordinator, store) = makeCoordinator([
            makeEntry(owner: "user-a", enqueuedAt: beforeLogout),
            makeEntry(owner: "user-a", enqueuedAt: beforeLogout),
            makeEntry(owner: "user-b", enqueuedAt: beforeLogout)
        ])

        try await coordinator.clearQueue(ownerUserId: "user-a", enqueuedBefore: logoutBoundary)

        let remaining = try store.loadEntries()
        XCTAssertEqual(remaining.count, 1)
        XCTAssertEqual(remaining.first?.ownerUserId, "user-b")
    }

    /// An unattributable owner id must not degrade into the blanket wipe this
    /// scoping replaced.
    func testClearQueueWithEmptyOwnerIsANoOp() async throws {
        let (coordinator, store) = makeCoordinator([
            makeEntry(owner: "user-a", enqueuedAt: beforeLogout)
        ])

        try await coordinator.clearQueue(ownerUserId: "", enqueuedBefore: logoutBoundary)

        XCTAssertEqual(try store.loadEntries().count, 1)
    }

    /// Legacy rows decoded without an owner are left alone rather than swept up by
    /// an unrelated account's sign-out.
    func testClearQueueLeavesLegacyOwnerlessEntriesAlone() async throws {
        let (coordinator, store) = makeCoordinator([
            makeEntry(owner: "", enqueuedAt: beforeLogout),
            makeEntry(owner: "user-a", enqueuedAt: beforeLogout)
        ])

        try await coordinator.clearQueue(ownerUserId: "user-a", enqueuedBefore: logoutBoundary)

        let remaining = try store.loadEntries()
        XCTAssertEqual(remaining.count, 1)
        XCTAssertEqual(remaining.first?.ownerUserId, "")
    }
}
