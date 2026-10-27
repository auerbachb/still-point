import Foundation
import Testing
@testable import StillPointShared

/// A stand-in for the API behind `SessionSyncTransport.live`. Like the real
/// batch route (#948), it stores a thought once per `clientThoughtId` and every
/// thought without one, and answers with only the thoughts that batch stored,
/// so a full replay is answered `[]`. It stores a batch before it answers, so a
/// batch whose answer is lost on the way back (`losingAnswers`) is stored all
/// the same.
private actor StubServer {
    /// Every thought the server holds, in the order it stored them.
    private(set) var stored: [PendingSessionThought] = []
    private(set) var batches: [BatchThoughtsRequest] = []
    /// How many thoughts each batch stored, which is what its answer listed.
    private(set) var storedPerBatch: [Int] = []
    private var answersToLose: Int

    init(losingAnswers answersToLose: Int = 0) {
        self.answersToLose = answersToLose
    }

    /// The thoughts each batch carried, ids included.
    var sentThoughts: [[PendingSessionThought]] {
        batches.map { $0.thoughts.map(Self.pending) }
    }

    nonisolated var transport: SessionSyncTransport {
        SessionSyncTransport(
            createSession: { request in SessionSyncCoordinator.sessionDTO(from: request, id: "server-971") },
            batchThoughts: { batch in try await self.receive(batch) }
        )
    }

    private func receive(_ batch: BatchThoughtsRequest) throws -> [ThoughtDTO] {
        batches.append(batch)
        var answer: [ThoughtDTO] = []
        for thought in batch.thoughts.map(Self.pending) {
            if let id = thought.clientThoughtId, stored.contains(where: { $0.clientThoughtId == id }) {
                continue
            }
            stored.append(thought)
            answer.append(ThoughtDTO(
                id: "thought-\(stored.count)",
                sessionId: batch.sessionId,
                dayNumber: batch.dayNumber,
                timeInSession: thought.timeInSession,
                text: thought.text
            ))
        }
        storedPerBatch.append(answer.count)
        if answersToLose > 0 {
            answersToLose -= 1
            throw URLError(.networkConnectionLost)
        }
        return answer
    }

    private static func pending(_ input: BatchThoughtsRequest.ThoughtInput) -> PendingSessionThought {
        PendingSessionThought(timeInSession: input.timeInSession, text: input.text, clientThoughtId: input.clientThoughtId)
    }
}

/// The queue as it stood when the first upload began.
private actor FirstUpload {
    private(set) var queuedThoughts: [PendingSessionThought]?

    func note(_ thoughts: [PendingSessionThought]) {
        if queuedThoughts == nil {
            queuedThoughts = thoughts
        }
    }
}

/// #971: iOS sends a `clientThoughtId` with each in-session thought, so a batch
/// the server stored before its answer was lost is stored once when it is sent
/// again. Mirrors web's `WebSessionSyncCoordinator thought ids (#948)` tests.
final class SessionSyncCoordinatorThoughtIdTests {
    private let owner = "user-test-971"
    /// Queue directories this test made; each test gets its own suite instance,
    /// so `deinit` removes them when that test ends.
    private var createdDirectories: [URL] = []

    deinit {
        for directory in createdDirectories {
            _ = try? FileManager.default.removeItem(at: directory)
        }
    }

    private func makeRequest(_ clientSessionId: UUID) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: 4,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 90,
            thoughtCount: 2,
            mindStateLog: [],
            sessionDate: "2026-10-27",
            clientSessionId: clientSessionId
        )
    }

    /// A sit that already has a server row, with these thoughts still queued.
    private func syncedEntry(_ clientSessionId: UUID, thoughts: [PendingSessionThought]) -> PendingSessionEntry {
        PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            request: makeRequest(clientSessionId),
            thoughts: thoughts,
            serverSessionId: "server-\(clientSessionId.uuidString)",
            sessionSynced: true
        )
    }

    /// A UUID in its 8-4-4-4-12 form, lowercased like web's `crypto.randomUUID()`.
    private func isLowercasedUUID(_ value: String) -> Bool {
        UUID(uuidString: value) != nil && value == value.lowercased()
    }

    private func temporaryQueueFileURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        createdDirectories.append(directory)
        return directory.appendingPathComponent(OfflineSessionQueue.fileName)
    }

    // MARK: - Minting

    @Test func testEachInSessionThoughtIsQueuedWithItsOwnIdBeforeTheFirstUploadAndTheEndNoteGetsNone() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let firstUpload = FirstUpload()
        let offline = SessionSyncTransport(
            createSession: { _ in
                let queued = try store.loadEntries().first?.thoughts ?? []
                await firstUpload.note(queued)
                throw URLError(.notConnectedToInternet)
            },
            batchThoughts: { _ in throw URLError(.notConnectedToInternet) }
        )
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: offline)
        let clientSessionId = UUID()
        let captured = [
            PendingSessionThought(timeInSession: 12, text: "rain"),
            PendingSessionThought(timeInSession: 12, text: "rain"),
            PendingSessionThought(timeInSession: 30, text: "car door"),
        ]

        _ = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: captured
        )
        try await coordinator.replaceEndNote(clientSessionId: clientSessionId, ownerUserId: owner, note: "offline note")

        let thoughts = try #require(store.loadEntries().first).thoughts
        #expect(thoughts.map(\.timeInSession) == [12, 12, 30, -1])
        #expect(thoughts.map(\.text) == ["rain", "rain", "car door", "offline note"])
        let ids = thoughts.prefix(3).map(\.clientThoughtId)
        for id in ids {
            let id = try #require(id)
            #expect(isLowercasedUUID(id), Comment(rawValue: id))
        }
        // The same words twice are two thoughts, so two ids.
        #expect(Set(ids).count == 3)
        #expect(thoughts[3].clientThoughtId == nil)
        // Already saved when the first upload began, so every attempt sends them.
        let queuedAtFirstUpload = await firstUpload.queuedThoughts
        #expect(queuedAtFirstUpload == Array(thoughts.prefix(3)))

        // Saving the sit again, as the completion screen's Retry does, keeps them.
        _ = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: captured
        )
        #expect(try store.loadEntries().first?.thoughts == thoughts)

        // Back online, the batch carries those ids, and the end note goes without one.
        let server = StubServer()
        try await SessionSyncCoordinator(queueStore: store, transport: server.transport)
            .flushPending(ownerUserId: owner)
        let sent = await server.sentThoughts
        #expect(sent == [thoughts])
    }

    /// Nothing hands `saveCompletedSession` an id or an end note today, but either
    /// is queued as handed: an id is kept, and the note gets none, because the
    /// server replaces it rather than storing it once.
    @Test func testAThoughtHandedInWithAnIdKeepsItAndAnEndNoteQueuedWithTheSitGetsNone() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let clientSessionId = UUID()
        let handed = [
            PendingSessionThought(timeInSession: 12, text: "rain", clientThoughtId: "97100000-0000-4000-8000-000000000001"),
            PendingSessionThought(timeInSession: -1, text: "a note"),
        ]

        _ = try await SessionSyncCoordinator(queueStore: store, transport: .alwaysFailing).saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: handed
        )

        #expect(try store.loadEntries().first?.thoughts == handed)
    }

    // MARK: - Replay

    @Test func testABatchStoredBeforeItsAnswerWasLostIsSentAgainWithTheSameIdsAndStoredOnce() async throws {
        let server = StubServer(losingAnswers: 1)
        let store = InMemoryOfflineSessionQueueStore()
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: server.transport)
        let clientSessionId = UUID()

        let saved = try await coordinator.saveCompletedSession(
            request: makeRequest(clientSessionId),
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            thoughts: [
                PendingSessionThought(timeInSession: 12, text: "rain"),
                PendingSessionThought(timeInSession: 30, text: "car door"),
            ]
        )

        // The answer was lost, so the thoughts stay queued, though the server has them.
        #expect(saved.isPendingSync)
        let queued = try #require(store.loadEntries().first).thoughts
        #expect(queued.count == 2)
        let storedBeforeReplay = await server.stored
        #expect(storedBeforeReplay == queued)

        let flushed = try await coordinator.flushPending(ownerUserId: owner)

        #expect(flushed == 1)
        let sent = await server.sentThoughts
        #expect(sent == [queued, queued])
        // The replay matched every id, so it stored nothing and was answered `[]`.
        let storedPerBatch = await server.storedPerBatch
        #expect(storedPerBatch == [2, 0])
        let stored = await server.stored
        #expect(stored == queued)
        // That empty answer still acknowledged them, so nothing is sent again.
        #expect(try store.loadEntries().first?.thoughts == [])
        let pending = try await coordinator.pendingCount(ownerUserId: owner)
        #expect(pending == 0)
    }

    // MARK: - Entries queued before #971

    /// A queue file written by a build from before #971 has no `clientThoughtId`
    /// keys. It must still load: a failed decode moves the whole queue aside as
    /// corrupt, losing every sit in it.
    @Test func testAnEntryQueuedBeforeIdsExistedStillFlushesSendingItsThoughtsAsQueued() async throws {
        let fileURL = try temporaryQueueFileURL()
        let clientSessionId = UUID()
        let legacyQueue = """
        [{"clearCompletionNote":false,"clientSessionId":"\(clientSessionId.uuidString)",\
        "enqueuedAt":"2026-10-26T08:00:00Z","ownerUserId":"\(owner)",\
        "request":{"actualTime":60,"bonusSeconds":0,"clearPercent":90,\
        "clientSessionId":"\(clientSessionId.uuidString)","completed":true,"dayNumber":4,\
        "duration":60,"mindStateLog":[],"sessionDate":"2026-10-26","sessionType":"standard",\
        "thoughtCount":1,"track":"primary"},"sessionSynced":false,\
        "thoughts":[{"text":"rain","timeInSession":12},{"text":"a note","timeInSession":-1}]}]
        """
        try Data(legacyQueue.utf8).write(to: fileURL)
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)

        let legacyThoughts = try #require(store.loadEntries().first).thoughts
        #expect(
            legacyThoughts == [
                PendingSessionThought(timeInSession: 12, text: "rain"),
                PendingSessionThought(timeInSession: -1, text: "a note"),
            ]
        )
        #expect(!FileManager.default.fileExists(atPath: fileURL.path + ".corrupt"))

        let server = StubServer()
        let flushed = try await SessionSyncCoordinator(queueStore: store, transport: server.transport)
            .flushPending(ownerUserId: owner)

        #expect(flushed == 1)
        // No ids are backfilled: the batch is the one sent before #971.
        let batches = await server.batches
        #expect(batches.count == 1)
        let body = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(batches[0])) as? [String: Any])
        let items = try #require(body["thoughts"] as? [[String: Any]])
        #expect(items.map { Set($0.keys) } == [["timeInSession", "text"], ["timeInSession", "text"]])
        let entry = try #require(store.loadEntries().first)
        #expect(entry.sessionSynced)
        #expect(entry.thoughts == [])
    }

    // MARK: - Acknowledgement

    @Test func testAThoughtIsAcknowledgedByItsOwnIdNotByATwinWithTheSameTimeAndText() async throws {
        let clientSessionId = UUID()
        let sent = PendingSessionThought(timeInSession: 12, text: "rain", clientThoughtId: "97100000-0000-4000-8000-000000000001")
        let twin = PendingSessionThought(timeInSession: 12, text: "rain", clientThoughtId: "97100000-0000-4000-8000-000000000002")
        let store = InMemoryOfflineSessionQueueStore(entries: [syncedEntry(clientSessionId, thoughts: [sent])])
        // A second thought with the same words is queued while the batch is out.
        let transport = SessionSyncTransport(
            createSession: { _ in throw URLError(.notConnectedToInternet) },
            batchThoughts: { _ in
                var entries = try store.loadEntries()
                entries[0].thoughts.append(twin)
                try store.saveEntries(entries)
                return []
            }
        )

        try await SessionSyncCoordinator(queueStore: store, transport: transport).flushPending(ownerUserId: owner)

        #expect(try store.loadEntries().first?.thoughts == [twin])
    }

    /// #753: a note edited again while its upload is out is a new note. Neither
    /// has an id, so the two are told apart by their text, as before #971.
    @Test func testAnEndNoteReplacedWhileItsUploadIsOutStaysQueued() async throws {
        let clientSessionId = UUID()
        let store = InMemoryOfflineSessionQueueStore(entries: [
            syncedEntry(clientSessionId, thoughts: [PendingSessionThought(timeInSession: -1, text: "first draft")]),
        ])
        let transport = SessionSyncTransport(
            createSession: { _ in throw URLError(.notConnectedToInternet) },
            batchThoughts: { _ in
                var entries = try store.loadEntries()
                entries[0].thoughts = [PendingSessionThought(timeInSession: -1, text: "second draft")]
                try store.saveEntries(entries)
                return []
            }
        )

        try await SessionSyncCoordinator(queueStore: store, transport: transport).flushPending(ownerUserId: owner)

        #expect(try store.loadEntries().first?.thoughts == [PendingSessionThought(timeInSession: -1, text: "second draft")])
    }

    // MARK: - Wire format

    /// The id must outlive a relaunch, or a retry after one would send a new id.
    @Test func testTheQueueFileKeepsAThoughtsIdAndLeavesTheKeyOutWithoutOne() throws {
        let fileURL = try temporaryQueueFileURL()
        let store = FileOfflineSessionQueueStore(fileURL: fileURL)
        let clientSessionId = UUID()
        let thoughts = [
            PendingSessionThought(timeInSession: 12, text: "rain", clientThoughtId: "97100000-0000-4000-8000-000000000001"),
            PendingSessionThought(timeInSession: -1, text: "note"),
        ]

        try store.saveEntries([PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            request: makeRequest(clientSessionId),
            thoughts: thoughts
        )])

        #expect(try store.loadEntries().first?.thoughts == thoughts)
        let saved = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)) as? [[String: Any]])
        let savedThoughts = try #require(saved.first?["thoughts"] as? [[String: Any]])
        #expect((savedThoughts.first?["clientThoughtId"] as? String) == "97100000-0000-4000-8000-000000000001")
        #expect(savedThoughts.map { Set($0.keys) } == [["timeInSession", "text", "clientThoughtId"], ["timeInSession", "text"]])
    }

    @Test func testABatchItemSendsTheIdOnlyWhenItHasOne() throws {
        let batch = BatchThoughtsRequest(
            sessionId: "s1",
            dayNumber: 2,
            thoughts: [
                BatchThoughtsRequest.ThoughtInput(timeInSession: 12, text: "rain", clientThoughtId: "97100000-0000-4000-8000-000000000001"),
                BatchThoughtsRequest.ThoughtInput(timeInSession: -1, text: "note"),
            ]
        )

        let body = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(batch)) as? [String: Any])
        let items = try #require(body["thoughts"] as? [[String: Any]])

        #expect(Set(body.keys) == ["sessionId", "dayNumber", "thoughts"])
        #expect((items.first?["clientThoughtId"] as? String) == "97100000-0000-4000-8000-000000000001")
        #expect(items.map { Set($0.keys) } == [["timeInSession", "text", "clientThoughtId"], ["timeInSession", "text"]])
    }
}
