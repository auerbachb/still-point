import XCTest
@testable import StillPointShared

final class OfflineSessionQueueTests: XCTestCase {
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
            request: request,
            thoughts: [PendingSessionThought(timeInSession: 10, text: "hello")]
        )

        try store.saveEntries([entry])
        let loaded = try store.loadEntries()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded[0].clientSessionId, clientSessionId)
        XCTAssertEqual(loaded[0].thoughts.first?.text, "hello")
        XCTAssertEqual(loaded[0].request.clientSessionId, clientSessionId)
    }

    func testInMemoryStoreStartsEmpty() throws {
        let store = InMemoryOfflineSessionQueueStore()
        XCTAssertTrue(try store.loadEntries().isEmpty)
    }
}

final class SessionSyncCoordinatorTests: XCTestCase {
    func testSaveCompletedSessionEnqueuesWhenSyncUnavailable() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(queueStore: store)
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
            thoughts: []
        )

        XCTAssertTrue(result.isPendingSync)
        XCTAssertEqual(result.session.id, clientSessionId.uuidString)
        let entries = try store.loadEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertFalse(entries[0].sessionSynced)
    }

    func testDuplicateClientSessionIdDoesNotDuplicateQueueEntries() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(queueStore: store)
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
            thoughts: []
        )
        _ = try await coordinator.saveCompletedSession(
            request: request,
            clientSessionId: clientSessionId,
            thoughts: []
        )

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
