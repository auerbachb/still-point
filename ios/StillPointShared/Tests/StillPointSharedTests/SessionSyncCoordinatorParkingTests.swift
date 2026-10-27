import XCTest
@testable import StillPointShared

/// Records which sits a transport was asked to create, and answers some of them
/// with an `APIError` instead of a session.
private actor RejectingUploads {
    private(set) var created: [UUID] = []
    private(set) var batchedSessionIds: [String] = []
    private var createAnswers: [UUID: APIError] = [:]
    private var batchAnswers: [String: APIError] = [:]

    func answerCreate(for clientSessionId: UUID, with error: APIError?) {
        createAnswers[clientSessionId] = error
    }

    func answerBatch(for sessionId: String, with error: APIError?) {
        batchAnswers[sessionId] = error
    }

    func create(_ request: CreateSessionRequest) throws -> SessionDTO {
        let clientSessionId = request.clientSessionId!
        created.append(clientSessionId)
        if let error = createAnswers[clientSessionId] { throw error }
        return SessionSyncCoordinator.sessionDTO(from: request, id: "server-\(clientSessionId.uuidString)")
    }

    func batch(_ request: BatchThoughtsRequest) throws -> [ThoughtDTO] {
        batchedSessionIds.append(request.sessionId)
        if let error = batchAnswers[request.sessionId] { throw error }
        return []
    }

    func reset() {
        created = []
        batchedSessionIds = []
    }
}

/// #983: a sit the server turns down for good is parked, as web does since #978.
/// Named for the behaviour under test: `SessionSyncCoordinatorTests` already
/// exists in `OfflineSessionQueueTests.swift`.
final class SessionSyncCoordinatorParkingTests: XCTestCase {
    private let owner = "user-test-983"

    private func queuedSit(
        _ clientSessionId: UUID = UUID(),
        sessionSynced: Bool = false,
        thoughts: [PendingSessionThought] = []
    ) -> PendingSessionEntry {
        PendingSessionEntry(
            clientSessionId: clientSessionId,
            ownerUserId: owner,
            request: CreateSessionRequest(
                dayNumber: 1,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: thoughts.count,
                mindStateLog: [],
                sessionDate: "2026-10-27",
                clientSessionId: clientSessionId
            ),
            thoughts: thoughts,
            serverSessionId: sessionSynced ? "server-\(clientSessionId.uuidString)" : nil,
            sessionSynced: sessionSynced
        )
    }

    private func makeCoordinator(
        _ entries: [PendingSessionEntry],
        uploads: RejectingUploads
    ) -> (SessionSyncCoordinator, InMemoryOfflineSessionQueueStore) {
        let store = InMemoryOfflineSessionQueueStore(entries: entries)
        let transport = SessionSyncTransport(
            createSession: { try await uploads.create($0) },
            batchThoughts: { try await uploads.batch($0) }
        )
        return (SessionSyncCoordinator(queueStore: store, transport: transport), store)
    }

    private func entry(_ id: UUID, in store: InMemoryOfflineSessionQueueStore) throws -> PendingSessionEntry? {
        try store.loadEntries().first { $0.clientSessionId == id }
    }

    func testASitAnswered400IsParkedAndTheSitsAroundItStillSync() async throws {
        let ahead = queuedSit()
        let rejected = queuedSit()
        let behind = queuedSit()
        let uploads = RejectingUploads()
        await uploads.answerCreate(
            for: rejected.clientSessionId,
            with: APIError(status: 400, message: "Invalid track")
        )
        let (coordinator, store) = makeCoordinator([ahead, rejected, behind], uploads: uploads)

        let flushed = try await coordinator.flushPending(ownerUserId: owner)

        XCTAssertEqual(flushed, 2)
        let created = await uploads.created
        XCTAssertEqual(created, [ahead.clientSessionId, rejected.clientSessionId, behind.clientSessionId])
        XCTAssertEqual(try entry(ahead.clientSessionId, in: store)?.sessionSynced, true)
        XCTAssertEqual(try entry(behind.clientSessionId, in: store)?.sessionSynced, true)
        let parked = try XCTUnwrap(try entry(rejected.clientSessionId, in: store))
        XCTAssertFalse(parked.sessionSynced)
        XCTAssertEqual(parked.parked?.status, 400)
        XCTAssertEqual(parked.parked?.message, "Invalid track")
        let pending = try await coordinator.pendingCount(ownerUserId: owner)
        XCTAssertEqual(pending, 0)

        // A second flush does not send the parked sit again.
        await uploads.reset()
        let flushedAgain = try await coordinator.flushPending(ownerUserId: owner)
        XCTAssertEqual(flushedAgain, 0)
        let createdAgain = await uploads.created
        XCTAssertEqual(createdAgain, [])

        // Pruning keeps the parked sit as its record.
        try await coordinator.pruneCompletedEntries(ownerUserId: owner)
        let remaining = try store.loadEntries().map(\.clientSessionId)
        XCTAssertEqual(remaining, [rejected.clientSessionId])
    }

    func testAThoughtsBatchAnswered404ParksItsSit() async throws {
        let rejected = queuedSit(
            sessionSynced: true,
            thoughts: [PendingSessionThought(timeInSession: 10, text: "a thought", clientThoughtId: "t-1")]
        )
        let uploads = RejectingUploads()
        await uploads.answerBatch(
            for: "server-\(rejected.clientSessionId.uuidString)",
            with: APIError(status: 404, message: "Session not found")
        )
        let (coordinator, store) = makeCoordinator([rejected], uploads: uploads)

        _ = try await coordinator.flushPending(ownerUserId: owner)
        await uploads.reset()
        _ = try await coordinator.flushPending(ownerUserId: owner)

        let batched = await uploads.batchedSessionIds
        XCTAssertEqual(batched, [])
        let parked = try XCTUnwrap(try entry(rejected.clientSessionId, in: store))
        XCTAssertEqual(parked.parked?.status, 404)
        XCTAssertEqual(parked.thoughts.count, 1)
    }

    func testA401LeavesTheSitQueuedAndALaterFlushSendsIt() async throws {
        let sit = queuedSit()
        let uploads = RejectingUploads()
        await uploads.answerCreate(for: sit.clientSessionId, with: APIError(status: 401, message: "Unauthorized"))
        let (coordinator, store) = makeCoordinator([sit], uploads: uploads)

        let flushed = try await coordinator.flushPending(ownerUserId: owner)

        XCTAssertEqual(flushed, 0)
        let queued = try XCTUnwrap(try entry(sit.clientSessionId, in: store))
        XCTAssertNil(queued.parked)
        XCTAssertFalse(queued.sessionSynced)
        let pending = try await coordinator.pendingCount(ownerUserId: owner)
        XCTAssertEqual(pending, 1)

        await uploads.answerCreate(for: sit.clientSessionId, with: nil)
        let flushedLater = try await coordinator.flushPending(ownerUserId: owner)

        XCTAssertEqual(flushedLater, 1)
        XCTAssertEqual(try entry(sit.clientSessionId, in: store)?.sessionSynced, true)
    }

    func testRetryableAndUnparkableAnswersLeaveTheSitQueued() async throws {
        for status in [0, 403, 408, 429, 500, 503] {
            let sit = queuedSit()
            let uploads = RejectingUploads()
            await uploads.answerCreate(for: sit.clientSessionId, with: APIError(status: status, message: "nope"))
            let (coordinator, store) = makeCoordinator([sit], uploads: uploads)

            _ = try await coordinator.flushPending(ownerUserId: owner)

            XCTAssertNil(try entry(sit.clientSessionId, in: store)?.parked, "status \(status)")
            let pending = try await coordinator.pendingCount(ownerUserId: owner)
            XCTAssertEqual(pending, 1, "status \(status)")
        }
    }

    func testANetworkFailureNeverParks() {
        XCTAssertFalse(SessionSyncCoordinator.rejectsTheSit(URLError(.notConnectedToInternet)))
        XCTAssertTrue(SessionSyncCoordinator.rejectsTheSit(APIError(status: 422, message: "x")))
    }

    func testANoteOnAParkedSitIsRefusedNotReportedSaved() async throws {
        let rejected = queuedSit(
            sessionSynced: true,
            thoughts: [PendingSessionThought(timeInSession: 10, text: "a thought", clientThoughtId: "t-1")]
        )
        let uploads = RejectingUploads()
        await uploads.answerBatch(
            for: "server-\(rejected.clientSessionId.uuidString)",
            with: APIError(status: 404, message: "Session not found")
        )
        let (coordinator, store) = makeCoordinator([rejected], uploads: uploads)
        _ = try await coordinator.flushPending(ownerUserId: owner)
        XCTAssertNotNil(try entry(rejected.clientSessionId, in: store)?.parked)

        do {
            try await coordinator.replaceEndNote(
                clientSessionId: rejected.clientSessionId,
                ownerUserId: owner,
                note: "never sent"
            )
            XCTFail("a note on a parked sit must not be reported saved")
        } catch SessionSyncError.entryParked {
            // expected
        }
        do {
            try await coordinator.clearEndNote(clientSessionId: rejected.clientSessionId, ownerUserId: owner)
            XCTFail("clearing the note of a parked sit must not be reported saved")
        } catch SessionSyncError.entryParked {
            // expected
        }

        let kept = try XCTUnwrap(try entry(rejected.clientSessionId, in: store))
        XCTAssertFalse(kept.thoughts.contains { $0.timeInSession == -1 })
        XCTAssertFalse(kept.clearCompletionNote)
    }

    func testTheParkedMessageIsCut() {
        let parked = PendingSessionParked(status: 400, message: String(repeating: "x", count: 500))
        XCTAssertEqual(parked.message.count, PendingSessionParked.messageMaxLength)
    }
}
