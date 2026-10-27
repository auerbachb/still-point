import Foundation
import Testing
@testable import StillPointShared

/// The offline queue's stores: what they keep, and which older queue files they
/// still load. The coordinator that fills the queue is `SessionSyncCoordinatorTests`.
final class OfflineSessionQueueTests {
    private let testOwnerUserId = "user-test-557"
    /// Queue directories this test made; each test gets its own suite instance,
    /// so `deinit` removes them when that test ends.
    private var createdDirectories: [URL] = []

    deinit {
        for directory in createdDirectories {
            _ = try? FileManager.default.removeItem(at: directory)
        }
    }

    private func temporaryQueueFileURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        createdDirectories.append(directory)
        return directory.appendingPathComponent(OfflineSessionQueue.fileName)
    }

    private func entry(
        _ request: CreateSessionRequest,
        clientSessionId: UUID,
        ownerUserId: String? = nil,
        thoughts: [PendingSessionThought] = [],
        parked: PendingSessionParked? = nil
    ) -> PendingSessionEntry {
        PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: ownerUserId ?? testOwnerUserId,
            request: request,
            thoughts: thoughts,
            parked: parked
        )
    }

    /// A queue file as a build from before #839 wrote it: one standard sit with none
    /// of the keys later builds added (`focusCategory`, `parked`, `combined`). A
    /// failed decode moves the whole queue aside as corrupt, losing every sit in it,
    /// so each of those keys has to stay optional.
    private func writeLegacyQueue(
        to fileURL: URL,
        clientSessionId: UUID,
        ownerUserId: String,
        dayNumber: Int,
        duration: Int,
        sessionDate: String
    ) throws {
        let legacyQueue = """
        [{"clearCompletionNote":false,"clientSessionId":"\(clientSessionId.uuidString)",\
        "enqueuedAt":"\(sessionDate)T08:00:00Z","ownerUserId":"\(ownerUserId)",\
        "request":{"actualTime":\(duration),"bonusSeconds":0,"clearPercent":80,\
        "clientSessionId":"\(clientSessionId.uuidString)","completed":true,"dayNumber":\(dayNumber),\
        "duration":\(duration),"mindStateLog":[],"sessionDate":"\(sessionDate)","sessionType":"standard",\
        "thoughtCount":0,"track":"primary"},"sessionSynced":false,"thoughts":[]}]
        """
        try Data(legacyQueue.utf8).write(to: fileURL)
    }

    private func wasMovedAsideAsCorrupt(_ fileURL: URL) -> Bool {
        FileManager.default.fileExists(atPath: fileURL.path + ".corrupt")
    }

    // MARK: - Stores

    @Test func testFileStoreRoundTrip() throws {
        let store = FileOfflineSessionQueueStore(fileURL: try temporaryQueueFileURL())
        let clientSessionId = UUID()
        let request = QueuedSitFixtures.request(
            dayNumber: 2,
            duration: 120,
            clearPercent: 80,
            thoughtCount: 1,
            clientSessionId: clientSessionId
        )

        try store.saveEntries([entry(
            request,
            clientSessionId: clientSessionId,
            thoughts: [PendingSessionThought(timeInSession: 10, text: "hello")]
        )])
        let loaded = try store.loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded[0].clientSessionId == clientSessionId)
        #expect(loaded[0].ownerUserId == testOwnerUserId)
        #expect(loaded[0].thoughts.first?.text == "hello")
        #expect(loaded[0].request.clientSessionId == clientSessionId)
    }

    @Test func testFileStoreRecoversFromCorruptQueueFile() throws {
        let fileURL = try temporaryQueueFileURL()
        try Data("{not-json".utf8).write(to: fileURL)
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)

        #expect(try store.loadEntries().isEmpty)
        #expect(wasMovedAsideAsCorrupt(fileURL))
    }

    @Test func testInMemoryStoreStartsEmpty() throws {
        let store = InMemoryOfflineSessionQueueStore()
        #expect(try store.loadEntries().isEmpty)
    }

    // MARK: - #839 focus category

    @Test func testFileStoreRoundTripsAQueuedFocusRequestWithItsCategory() throws {
        let store = FileOfflineSessionQueueStore(fileURL: try temporaryQueueFileURL())
        let clientSessionId = UUID()
        let request = QueuedSitFixtures.request(
            dayNumber: 3,
            sessionType: .focus,
            duration: 180,
            clearPercent: 0,
            sessionDate: "2026-10-27",
            focusCategory: .reading,
            clientSessionId: clientSessionId
        )

        try store.saveEntries([entry(request, clientSessionId: clientSessionId)])
        let loaded = try store.loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded[0].request.sessionType == .focus)
        #expect(loaded[0].request.focusCategory == .reading)
        #expect(loaded[0].request.clientSessionId == clientSessionId)
    }

    /// A sit queued by a build from before #839 has no `focusCategory` key. It must still
    /// load: a failed decode moves the whole queue aside as corrupt, losing every sit in it.
    @Test func testFileStoreLoadsAnEntryQueuedBeforeFocusCategoryExisted() throws {
        let fileURL = try temporaryQueueFileURL()
        let clientSessionId = UUID()
        try writeLegacyQueue(
            to: fileURL,
            clientSessionId: clientSessionId,
            ownerUserId: testOwnerUserId,
            dayNumber: 2,
            duration: 120,
            sessionDate: "2026-07-17"
        )

        let loaded = try FileOfflineSessionQueueStore(fileURL: fileURL).loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded.first?.clientSessionId == clientSessionId)
        #expect(loaded.first?.request.sessionType == .standard)
        #expect(loaded.first?.request.focusCategory == nil)
        #expect(!wasMovedAsideAsCorrupt(fileURL))
    }

    // MARK: - #983 parking

    /// #983: a sit queued by a build from before parking has no `parked` key. It
    /// decodes as never turned down, and a flush sends it as before.
    @Test func testFileStoreLoadsAndFlushesAnEntryQueuedBeforeParkingExisted() async throws {
        let fileURL = try temporaryQueueFileURL()
        try writeLegacyQueue(
            to: fileURL,
            clientSessionId: UUID(),
            ownerUserId: testOwnerUserId,
            dayNumber: 2,
            duration: 120,
            sessionDate: "2026-10-20"
        )
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)

        let loaded = try store.loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded.first?.parked == nil)
        #expect(!wasMovedAsideAsCorrupt(fileURL))

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
        let store = FileOfflineSessionQueueStore(fileURL: try temporaryQueueFileURL())
        let clientSessionId = UUID()
        let parked = PendingSessionParked(
            at: Date(timeIntervalSince1970: 1_790_000_000),
            status: 400,
            message: "Invalid track"
        )
        let request = QueuedSitFixtures.request(
            clearPercent: 50,
            sessionDate: "2026-10-27",
            clientSessionId: clientSessionId
        )

        try store.saveEntries([entry(request, clientSessionId: clientSessionId, parked: parked)])

        #expect(try store.loadEntries().first?.parked == parked)
    }

    // MARK: - #896 combined sit

    @Test func testFileStoreRoundTripsAQueuedCombinedRequest() throws {
        let store = FileOfflineSessionQueueStore(fileURL: try temporaryQueueFileURL())
        let clientSessionId = UUID()

        try store.saveEntries([entry(
            QueuedSitFixtures.combinedRequest(clientSessionId: clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: "user-test-896"
        )])
        let loaded = try store.loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded[0].request.combined == true)
        #expect(loaded[0].request.track == .primary)
    }

    /// A sit queued by a build from before #896 has no `combined` key. It must still
    /// load (a failed decode moves the whole queue aside as corrupt), as not combined.
    @Test func testFileStoreLoadsAnEntryQueuedBeforeCombinedExisted() throws {
        let fileURL = try temporaryQueueFileURL()
        let clientSessionId = UUID()
        try writeLegacyQueue(
            to: fileURL,
            clientSessionId: clientSessionId,
            ownerUserId: "user-test-896",
            dayNumber: 30,
            duration: 600,
            sessionDate: "2026-10-26"
        )

        let loaded = try FileOfflineSessionQueueStore(fileURL: fileURL).loadEntries()

        #expect(loaded.count == 1)
        #expect(loaded.first?.clientSessionId == clientSessionId)
        #expect(loaded.first?.request.combined == false)
        #expect(!wasMovedAsideAsCorrupt(fileURL))
    }
}
