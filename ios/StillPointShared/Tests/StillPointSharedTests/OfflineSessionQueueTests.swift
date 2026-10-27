import XCTest
@testable import StillPointShared

final class OfflineSessionQueueTests: XCTestCase {
    private let testOwnerUserId = "user-test-557"

    func testFileStoreRoundTrip() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let fileURL = directory.appendingPathComponent(OfflineSessionQueue.fileName)
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 2,
            duration: 120,
            completed: true,
            actualTime: 120,
            clearPercent: 80,
            thoughtCount: 1,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )
        let entry = PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            request: request,
            thoughts: [PendingSessionThought(timeInSession: 10, text: "hello")]
        )

        try store.saveEntries([entry])
        let loaded = try store.loadEntries()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded[0].clientSessionId, clientSessionId)
        XCTAssertEqual(loaded[0].ownerUserId, testOwnerUserId)
        XCTAssertEqual(loaded[0].thoughts.first?.text, "hello")
        XCTAssertEqual(loaded[0].request.clientSessionId, clientSessionId)
    }

    func testFileStoreRecoversFromCorruptQueueFile() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let fileURL = directory.appendingPathComponent(OfflineSessionQueue.fileName)
        try Data("{not-json".utf8).write(to: fileURL)
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)

        XCTAssertTrue(try store.loadEntries().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))
    }

    func testInMemoryStoreStartsEmpty() throws {
        let store = InMemoryOfflineSessionQueueStore()
        XCTAssertTrue(try store.loadEntries().isEmpty)
    }

    // MARK: - #839 focus category

    func testFileStoreRoundTripsAQueuedFocusRequestWithItsCategory() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = FileOfflineSessionQueueStore(fileURL: directory.appendingPathComponent(OfflineSessionQueue.fileName))
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 3,
            sessionType: .focus,
            duration: 180,
            completed: true,
            actualTime: 180,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-10-27",
            focusCategory: .reading,
            clientSessionId: clientSessionId
        )

        try store.saveEntries([PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            request: request,
            thoughts: []
        )])
        let loaded = try store.loadEntries()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded[0].request.sessionType, .focus)
        XCTAssertEqual(loaded[0].request.focusCategory, .reading)
        XCTAssertEqual(loaded[0].request.clientSessionId, clientSessionId)
    }

    /// A sit queued by a build from before #839 has no `focusCategory` key. It must still
    /// load: a failed decode moves the whole queue aside as corrupt, losing every sit in it.
    func testFileStoreLoadsAnEntryQueuedBeforeFocusCategoryExisted() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let fileURL = directory.appendingPathComponent(OfflineSessionQueue.fileName)
        let clientSessionId = UUID()
        let legacyQueue = """
        [{"clearCompletionNote":false,"clientSessionId":"\(clientSessionId.uuidString)",\
        "enqueuedAt":"2026-07-17T08:00:00Z","ownerUserId":"\(testOwnerUserId)",\
        "request":{"actualTime":120,"bonusSeconds":0,"clearPercent":80,\
        "clientSessionId":"\(clientSessionId.uuidString)","completed":true,"dayNumber":2,\
        "duration":120,"mindStateLog":[],"sessionDate":"2026-07-17","sessionType":"standard",\
        "thoughtCount":0,"track":"primary"},"sessionSynced":false,"thoughts":[]}]
        """
        try Data(legacyQueue.utf8).write(to: fileURL)

        let loaded = try FileOfflineSessionQueueStore(fileURL: fileURL).loadEntries()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded.first?.clientSessionId, clientSessionId)
        XCTAssertEqual(loaded.first?.request.sessionType, .standard)
        XCTAssertNil(loaded.first?.request.focusCategory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))
    }
}

/// Records every create request a transport is handed.
private actor CreateRequestRecorder {
    private(set) var requests: [CreateSessionRequest] = []

    func record(_ request: CreateSessionRequest) {
        requests.append(request)
    }
}

final class SessionSyncCoordinatorTests: XCTestCase {
    private let testOwnerUserId = "user-test-557"

    func testSaveCompletedSessionEnqueuesWhenSyncUnavailable() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: .alwaysFailing
        )
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 1,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 100,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )

        let result = try await coordinator.saveCompletedSession(
            request: request,
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: []
        )

        XCTAssertTrue(result.isPendingSync)
        XCTAssertEqual(result.session.id, clientSessionId.uuidString)
        let entries = try store.loadEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].ownerUserId, testOwnerUserId)
        XCTAssertFalse(entries[0].sessionSynced)
    }

    func testDuplicateClientSessionIdDoesNotDuplicateQueueEntries() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: .alwaysFailing
        )
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 1,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 100,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )

        _ = try await coordinator.saveCompletedSession(
            request: request,
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: []
        )
        _ = try await coordinator.saveCompletedSession(
            request: request,
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: []
        )

        XCTAssertEqual(try store.loadEntries().count, 1)
    }

    func testFlushPendingSkipsEntriesOwnedByAnotherUser() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: .alwaysFailing
        )
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 1,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 100,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )

        _ = try await coordinator.saveCompletedSession(
            request: request,
            clientSessionId: clientSessionId,
            ownerUserId: "user-a",
            thoughts: []
        )

        let flushed = try await coordinator.flushPending(ownerUserId: "user-b")
        XCTAssertEqual(flushed, 0)
        XCTAssertEqual(try store.loadEntries().count, 1)
    }

    func testProvisionalSessionDTOUsesClientId() {
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 3,
            sessionType: .quick,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 100,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )

        let dto = SessionSyncCoordinator.provisionalSessionDTO(
            from: request,
            clientSessionId: clientSessionId
        )
        XCTAssertEqual(dto.id, clientSessionId.uuidString)
        XCTAssertEqual(dto.sessionType, .quick)
    }

    func testReplaceEndNoteReplacesQueuedEndNote() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: .alwaysFailing
        )
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 1,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 100,
            thoughtCount: 1,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )
        _ = try await coordinator.saveCompletedSession(
            request: request,
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: [PendingSessionThought(timeInSession: 12, text: "mid-sit")]
        )
        try await coordinator.replaceEndNote(
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            note: "first draft"
        )
        try await coordinator.replaceEndNote(
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            note: "revised note"
        )

        let thoughts = try store.loadEntries()[0].thoughts
        XCTAssertEqual(thoughts, [
            PendingSessionThought(timeInSession: 12, text: "mid-sit"),
            PendingSessionThought(timeInSession: -1, text: "revised note"),
        ])
    }

    // MARK: - #839 focus category

    private func focusRequest() -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: 5,
            sessionType: .focus,
            duration: 300,
            completed: true,
            actualTime: 300,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-10-27",
            focusCategory: .writing
        )
    }

    /// The coordinator rebuilds the request (`requestWithClientId`) before it queues and
    /// uploads it, and rebuilds a session from it (`sessionDTO(from:id:)`) for the caller.
    /// Either copy dropping the category would lose it without an error.
    func testPendingFocusSessionKeepsItsCategoryInTheQueueUploadAndReturnedSession() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let recorder = CreateRequestRecorder()
        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: SessionSyncTransport(
                createSession: { request in
                    await recorder.record(request)
                    throw URLError(.notConnectedToInternet)
                },
                batchThoughts: { _ in [] }
            )
        )
        let clientSessionId = UUID()

        let result = try await coordinator.saveCompletedSession(
            request: focusRequest(),
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            thoughts: []
        )

        XCTAssertTrue(result.isPendingSync)
        XCTAssertEqual(result.session.id, clientSessionId.uuidString)
        XCTAssertEqual(result.session.sessionType, .focus)
        XCTAssertEqual(result.session.focusCategory, .writing)
        let queued = try store.loadEntries()
        XCTAssertEqual(queued.count, 1)
        XCTAssertEqual(queued.first?.request.clientSessionId, clientSessionId)
        XCTAssertEqual(queued.first?.request.focusCategory, .writing)
        let uploaded = await recorder.requests
        XCTAssertEqual(uploaded.count, 1)
        XCTAssertEqual(uploaded.first?.focusCategory, .writing)
    }

    func testSyncedFocusSessionKeepsItsCategory() async throws {
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

        XCTAssertFalse(result.isPendingSync)
        XCTAssertEqual(result.session.id, "server-839")
        XCTAssertEqual(result.session.focusCategory, .writing)
        let uploaded = await recorder.requests
        XCTAssertEqual(uploaded.first?.focusCategory, .writing)
    }
}
