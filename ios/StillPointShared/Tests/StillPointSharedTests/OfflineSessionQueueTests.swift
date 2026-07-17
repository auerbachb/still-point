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
}
