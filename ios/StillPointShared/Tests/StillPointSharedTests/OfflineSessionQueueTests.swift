import Foundation
import Testing
@testable import StillPointShared

struct OfflineSessionQueueTests {
    private let testOwnerUserId = "user-test-557"

    @Test func testFileStoreRoundTrip() throws {
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

        #expect(loaded.count == 1)
        #expect(loaded[0].clientSessionId == clientSessionId)
        #expect(loaded[0].ownerUserId == testOwnerUserId)
        #expect(loaded[0].thoughts.first?.text == "hello")
        #expect(loaded[0].request.clientSessionId == clientSessionId)
    }

    @Test func testFileStoreRecoversFromCorruptQueueFile() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let fileURL = directory.appendingPathComponent(OfflineSessionQueue.fileName)
        try Data("{not-json".utf8).write(to: fileURL)
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)

        #expect(try store.loadEntries().isEmpty)
        #expect(FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))
    }

    @Test func testInMemoryStoreStartsEmpty() throws {
        let store = InMemoryOfflineSessionQueueStore()
        #expect(try store.loadEntries().isEmpty)
    }

    // MARK: - #839 focus category

    @Test func testFileStoreRoundTripsAQueuedFocusRequestWithItsCategory() throws {
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

        #expect(loaded.count == 1)
        #expect(loaded[0].request.sessionType == .focus)
        #expect(loaded[0].request.focusCategory == .reading)
        #expect(loaded[0].request.clientSessionId == clientSessionId)
    }

    /// A sit queued by a build from before #839 has no `focusCategory` key. It must still
    /// load: a failed decode moves the whole queue aside as corrupt, losing every sit in it.
    @Test func testFileStoreLoadsAnEntryQueuedBeforeFocusCategoryExisted() throws {
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

        #expect(loaded.count == 1)
        #expect(loaded.first?.clientSessionId == clientSessionId)
        #expect(loaded.first?.request.sessionType == .standard)
        #expect(loaded.first?.request.focusCategory == nil)
        #expect(!FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))
    }

    /// #983: a sit queued by a build from before parking has no `parked` key. It
    /// decodes as never turned down, and a flush sends it as before.
    @Test func testFileStoreLoadsAndFlushesAnEntryQueuedBeforeParkingExisted() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let fileURL = directory.appendingPathComponent(OfflineSessionQueue.fileName)
        let clientSessionId = UUID()
        let legacyQueue = """
        [{"clearCompletionNote":false,"clientSessionId":"\(clientSessionId.uuidString)",\
        "enqueuedAt":"2026-10-20T08:00:00Z","ownerUserId":"\(testOwnerUserId)",\
        "request":{"actualTime":120,"bonusSeconds":0,"clearPercent":80,\
        "clientSessionId":"\(clientSessionId.uuidString)","completed":true,"dayNumber":2,\
        "duration":120,"mindStateLog":[],"sessionDate":"2026-10-20","sessionType":"standard",\
        "thoughtCount":0,"track":"primary"},"sessionSynced":false,"thoughts":[]}]
        """
        try Data(legacyQueue.utf8).write(to: fileURL)
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)

        let loaded = try store.loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded.first?.parked == nil)
        #expect(!FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))

        let coordinator = SessionSyncCoordinator(
            queueStore: store,
            transport: SessionSyncTransport(
                createSession: { SessionSyncCoordinator.sessionDTO(from: $0, id: "server-legacy") },
                batchThoughts: { _ in [] }
            )
        )
        let pending = try await coordinator.pendingCount(ownerUserId: testOwnerUserId)
        #expect(pending == 1)
        let flushed = try await coordinator.flushPending(ownerUserId: testOwnerUserId)
        #expect(flushed == 1)
        let flushedEntry = try store.loadEntries().first
        #expect(flushedEntry?.serverSessionId == "server-legacy")
        #expect(flushedEntry?.parked == nil)
    }

    /// #983: a parked entry keeps its answer through the file store.
    @Test func testFileStoreRoundTripsAParkedEntry() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = FileOfflineSessionQueueStore(
            fileURL: directory.appendingPathComponent(OfflineSessionQueue.fileName)
        )
        let clientSessionId = UUID()
        let parked = PendingSessionParked(
            at: Date(timeIntervalSince1970: 1_790_000_000),
            status: 400,
            message: "Invalid track"
        )
        try store.saveEntries([PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            request: CreateSessionRequest(
                dayNumber: 1,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: [],
                sessionDate: "2026-10-27",
                clientSessionId: clientSessionId
            ),
            thoughts: [],
            parked: parked
        )])

        #expect(try store.loadEntries().first?.parked == parked)
    }
}

/// Records every create request a transport is handed.
private actor CreateRequestRecorder {
    private(set) var requests: [CreateSessionRequest] = []

    func record(_ request: CreateSessionRequest) {
        requests.append(request)
    }
}

struct SessionSyncCoordinatorTests {
    private let testOwnerUserId = "user-test-557"

    @Test func testSaveCompletedSessionEnqueuesWhenSyncUnavailable() async throws {
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

        #expect(result.isPendingSync)
        #expect(result.session.id == clientSessionId.uuidString)
        let entries = try store.loadEntries()
        #expect(entries.count == 1)
        #expect(entries[0].ownerUserId == testOwnerUserId)
        #expect(!entries[0].sessionSynced)
    }

    @Test func testDuplicateClientSessionIdDoesNotDuplicateQueueEntries() async throws {
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

        #expect(try store.loadEntries().count == 1)
    }

    @Test func testFlushPendingSkipsEntriesOwnedByAnotherUser() async throws {
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
        #expect(flushed == 0)
        #expect(try store.loadEntries().count == 1)
    }

    @Test func testProvisionalSessionDTOUsesClientId() {
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
        #expect(dto.id == clientSessionId.uuidString)
        #expect(dto.sessionType == .quick)
    }

    @Test func testReplaceEndNoteReplacesQueuedEndNote() async throws {
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
    @Test func testPendingFocusSessionKeepsItsCategoryInTheQueueUploadAndReturnedSession() async throws {
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
}

// MARK: - #896 combined sit

private func combinedRequest(clientSessionId: UUID? = nil) -> CreateSessionRequest {
    CreateSessionRequest(
        dayNumber: 30,
        duration: 1200,
        completed: true,
        actualTime: 1200,
        clearPercent: 85,
        thoughtCount: 0,
        mindStateLog: [],
        sessionDate: "2026-10-27",
        clientSessionId: clientSessionId,
        combined: true
    )
}

extension OfflineSessionQueueTests {
    @Test func testFileStoreRoundTripsAQueuedCombinedRequest() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = FileOfflineSessionQueueStore(fileURL: directory.appendingPathComponent(OfflineSessionQueue.fileName))
        let clientSessionId = UUID()
        try store.saveEntries([PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: "user-test-896",
            request: combinedRequest(clientSessionId: clientSessionId),
            thoughts: []
        )])
        let loaded = try store.loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded[0].request.combined == true)
        #expect(loaded[0].request.track == .primary)
    }

    /// A sit queued by a build from before #896 has no `combined` key. It must still
    /// load (a failed decode moves the whole queue aside as corrupt), as not combined.
    @Test func testFileStoreLoadsAnEntryQueuedBeforeCombinedExisted() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let fileURL = directory.appendingPathComponent(OfflineSessionQueue.fileName)
        let clientSessionId = UUID()
        let legacyQueue = """
        [{"clearCompletionNote":false,"clientSessionId":"\(clientSessionId.uuidString)",\
        "enqueuedAt":"2026-10-26T08:00:00Z","ownerUserId":"user-test-896",\
        "request":{"actualTime":600,"bonusSeconds":0,"clearPercent":80,\
        "clientSessionId":"\(clientSessionId.uuidString)","completed":true,"dayNumber":30,\
        "duration":600,"mindStateLog":[],"sessionDate":"2026-10-26","sessionType":"standard",\
        "thoughtCount":0,"track":"primary"},"sessionSynced":false,"thoughts":[]}]
        """
        try Data(legacyQueue.utf8).write(to: fileURL)

        let loaded = try FileOfflineSessionQueueStore(fileURL: fileURL).loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded.first?.clientSessionId == clientSessionId)
        #expect(loaded.first?.request.combined == false)
        #expect(!FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))
    }

    /// The coordinator rebuilds the request (`requestWithClientId`) before it queues
    /// and uploads it, and rebuilds a session from it (`sessionDTO(from:id:)`). Either
    /// copy dropping `combined` would lose it without an error.
    @Test func testPendingCombinedSitKeepsTheFlagInTheQueueUploadAndReturnedSession() async throws {
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
            request: combinedRequest(),
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
