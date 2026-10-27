import Foundation
import Testing
@testable import StillPointShared

/// The coordinator's save path: what it queues when the server is out of reach,
/// and which fields survive the request and session it rebuilds along the way.
/// The queue stores themselves are `OfflineSessionQueueTests`.
struct SessionSyncCoordinatorTests {
    private let testOwnerUserId = "user-test-557"

    private func offlineCoordinator(
        store: InMemoryOfflineSessionQueueStore
    ) -> SessionSyncCoordinator {
        SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing)
    }

    /// A transport that records each create request, then fails it as offline.
    private func recordingOfflineTransport(_ recorder: CreateRequestRecorder) -> SessionSyncTransport {
        SessionSyncTransport(
            createSession: { request in
                await recorder.record(request)
                throw URLError(.notConnectedToInternet)
            },
            batchThoughts: { _ in [] }
        )
    }

    @Test func testSaveCompletedSessionEnqueuesWhenSyncUnavailable() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = offlineCoordinator(store: store)
        let clientSessionId = UUID()

        let result = try await coordinator.saveCompletedSession(
            request: QueuedSitFixtures.request(clientSessionId: clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: []
        )

        #expect(result.isPendingSync)
        #expect(result.session.id == clientSessionId.uuidString)
        let entries = try store.loadEntries()
        #expect(entries.count == 1)
        #expect(entries[0].ownerUserId == testOwnerUserId)
        #expect(!entries[0].sessionSynced)
    }

    @Test func testDuplicateClientSessionIdDoesNotDuplicateQueueEntries() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = offlineCoordinator(store: store)
        let clientSessionId = UUID()
        let request = QueuedSitFixtures.request(clientSessionId: clientSessionId)

        for _ in 0..<2 {
            _ = try await coordinator.saveCompletedSession(
                request: request,
                clientSessionId: clientSessionId,
                ownerUserId: testOwnerUserId,
                thoughts: []
            )
        }

        #expect(try store.loadEntries().count == 1)
    }

    @Test func testFlushPendingSkipsEntriesOwnedByAnotherUser() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let clientSessionId = UUID()
        _ = try await offlineCoordinator(store: store).saveCompletedSession(
            request: QueuedSitFixtures.request(clientSessionId: clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: "user-a",
            thoughts: []
        )
        // A fresh recorder over the same queue, so only the flushes below are counted.
        let recorder = CreateRequestRecorder()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: recordingOfflineTransport(recorder)
        )

        let flushed = try await coordinator.flushPending(ownerUserId: "user-b")
        #expect(flushed == 0)
        #expect(await recorder.requests.isEmpty)
        #expect(try store.loadEntries().count == 1)

        // Control: the owner's flush does reach the transport, so the empty
        // recording above is the owner check at work, not a recorder that sees nothing.
        _ = try await coordinator.flushPending(ownerUserId: "user-a")
        let ownerUploads = await recorder.requests
        #expect(ownerUploads.count == 1)
        #expect(ownerUploads.first?.clientSessionId == clientSessionId)
    }

    @Test func testProvisionalSessionDTOUsesClientId() {
        let clientSessionId = UUID()
        let request = QueuedSitFixtures.request(
            dayNumber: 3,
            sessionType: .quick,
            clientSessionId: clientSessionId
        )

        let dto = SessionSyncCoordinator.provisionalSessionDTO(
            from: request,
            clientSessionId: clientSessionId
        )
        #expect(dto.id == clientSessionId.uuidString)
        #expect(dto.sessionType == .quick)
    }

    @Test func testReplaceEndNoteReplacesQueuedEndNote() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = offlineCoordinator(store: store)
        let clientSessionId = UUID()
        _ = try await coordinator.saveCompletedSession(
            request: QueuedSitFixtures.request(thoughtCount: 1, clientSessionId: clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: [PendingSessionThought(timeInSession: 12, text: "mid-sit")]
        )
        // #971: the in-session thought was given an id when the sit was queued.
        let midSitId = try #require(try store.loadEntries()[0].thoughts.first?.clientThoughtId)
        for note in ["first draft", "revised note"] {
            try await coordinator.replaceEndNote(
                clientSessionId: clientSessionId,
                ownerUserId: testOwnerUserId,
                note: note
            )
        }

        // Replacing the end note keeps the mid-sit thought's id, so a retried
        // upload is still recognized server-side as the same thought.
        let thoughts = try store.loadEntries()[0].thoughts
        #expect(
            thoughts == [
                PendingSessionThought(timeInSession: 12, text: "mid-sit", clientThoughtId: midSitId),
                PendingSessionThought(timeInSession: -1, text: "revised note"),
            ]
        )
    }

    // MARK: - #839 focus category

    private func focusRequest() -> CreateSessionRequest {
        QueuedSitFixtures.request(
            dayNumber: 5,
            sessionType: .focus,
            duration: 300,
            clearPercent: 0,
            sessionDate: "2026-10-27",
            focusCategory: .writing
        )
    }

    /// The coordinator rebuilds the request (`requestWithClientId`) before it queues and
    /// uploads it, and rebuilds a session from it (`sessionDTO(from:id:)`) for the caller.
    /// Either copy dropping the category would lose it without an error.
    @Test func testPendingFocusSessionKeepsItsCategoryInTheQueueUploadAndReturnedSession() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let recorder = CreateRequestRecorder()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: recordingOfflineTransport(recorder)
        )
        let clientSessionId = UUID()

        let result = try await coordinator.saveCompletedSession(
            request: focusRequest(),
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: []
        )

        #expect(result.isPendingSync)
        #expect(result.session.id == clientSessionId.uuidString)
        #expect(result.session.sessionType == .focus)
        #expect(result.session.focusCategory == .writing)
        let queued = try store.loadEntries()
        #expect(queued.count == 1)
        #expect(queued.first?.request.clientSessionId == clientSessionId)
        #expect(queued.first?.request.focusCategory == .writing)
        let uploaded = await recorder.requests
        #expect(uploaded.count == 1)
        #expect(uploaded.first?.focusCategory == .writing)
    }

    @Test func testSyncedFocusSessionKeepsItsCategory() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let recorder = CreateRequestRecorder()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: SessionSyncTransport(
                createSession: { request in
                    await recorder.record(request)
                    // Production keeps only the server id from this response and
                    // rebuilds the session from the request (`sessionDTO(from:id:)`).
                    // Every other field is a placeholder with no category, so the
                    // category below can only have come from the request.
                    return SessionDTO(
                        id: "server-839",
                        dayNumber: 0,
                        duration: 0,
                        completed: false,
                        actualTime: nil,
                        clearPercent: 0,
                        thoughtCount: 0,
                        mindStateLog: nil,
                        sessionDate: "",
                        buddySessionId: nil
                    )
                },
                batchThoughts: { _ in [] }
            )
        )

        let result = try await coordinator.saveCompletedSession(
            request: focusRequest(),
            clientSessionId: UUID(),
            ownerUserId: testOwnerUserId,
            thoughts: []
        )

        #expect(!result.isPendingSync)
        #expect(result.session.id == "server-839")
        #expect(result.session.sessionType == .focus)
        #expect(result.session.focusCategory == .writing)
        let uploaded = await recorder.requests
        #expect(uploaded.count == 1)
        #expect(uploaded.first?.focusCategory == .writing)
    }

    // MARK: - #896 combined sit

    /// The coordinator rebuilds the request (`requestWithClientId`) before it queues
    /// and uploads it, and rebuilds a session from it (`sessionDTO(from:id:)`). Either
    /// copy dropping `combined` would lose it without an error.
    @Test func testPendingCombinedSitKeepsTheFlagInTheQueueUploadAndReturnedSession() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let recorder = CreateRequestRecorder()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: recordingOfflineTransport(recorder)
        )
        let clientSessionId = UUID()

        let result = try await coordinator.saveCompletedSession(
            request: QueuedSitFixtures.combinedRequest(),
            clientSessionId: clientSessionId,
            ownerUserId: "user-test-896",
            thoughts: []
        )

        #expect(result.isPendingSync)
        #expect(result.session.combined == true)
        let queued = try store.loadEntries()
        #expect(queued.first?.request.combined == true)
        #expect(queued.first?.request.clientSessionId == clientSessionId)
        let uploaded = await recorder.requests
        #expect(uploaded.count == 1)
        #expect(uploaded.first?.combined == true)
    }
}
