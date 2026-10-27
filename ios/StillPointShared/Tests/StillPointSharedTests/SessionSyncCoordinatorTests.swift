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
        let coordinator = offlineCoordinator(store: store)
        let clientSessionId = UUID()

        _ = try await coordinator.saveCompletedSession(
            request: QueuedSitFixtures.request(clientSessionId: clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: "user-a",
            thoughts: []
        )

        let flushed = try await coordinator.flushPending(ownerUserId: "user-b")
        #expect(flushed == 0)
        #expect(try store.loadEntries().count == 1)
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
        for note in ["first draft", "revised note"] {
            try await coordinator.replaceEndNote(
                clientSessionId: clientSessionId,
                ownerUserId: testOwnerUserId,
                note: note
            )
        }

        let thoughts = try store.loadEntries()[0].thoughts
        // #971: the in-session thought was given an id when the sit was queued.
        let midSitId = try #require(thoughts.first?.clientThoughtId)
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
                    return SessionDTO(
                        id: "server-839",
                        dayNumber: request.dayNumber,
                        sessionType: request.sessionType,
                        duration: request.duration,
                        completed: request.completed,
                        actualTime: request.actualTime,
                        clearPercent: request.clearPercent,
                        thoughtCount: request.thoughtCount,
                        mindStateLog: request.mindStateLog,
                        sessionDate: request.sessionDate,
                        buddySessionId: nil,
                        focusCategory: request.focusCategory
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
        #expect(result.session.focusCategory == .writing)
        let uploaded = await recorder.requests
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
