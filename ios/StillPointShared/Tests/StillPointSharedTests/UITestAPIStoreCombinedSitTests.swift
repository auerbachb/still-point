import XCTest
@testable import StillPointShared

/// #896: `UITestAPIStore` mirrors the server's combined-sit rules (#890). A
/// completed combined sit advances both counters by one, an ended-early one
/// advances neither, and its done-today answer counts both tracks.
final class UITestAPIStoreCombinedSitTests: XCTestCase {
    private var defaultsKey = ""

    override func setUp() {
        super.setUp()
        defaultsKey = "StillPoint.UnitTest.UITestAPIStore.\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        super.tearDown()
    }

    private func makeStore(dualTrackEnabled: Bool = true) -> UITestAPIStore {
        UITestAPIStore.makeForUnitTests(
            user: UserDTO(
                id: "u-896", email: "u@example.com", username: "u", isPublic: false,
                currentDay: 45, dualTrackEnabled: dualTrackEnabled, secondTrackDay: 10
            ),
            defaultsKey: defaultsKey
        )
    }

    private func request(completed: Bool, combined: Bool, track: Track = .primary) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: 45, duration: 650, completed: completed, actualTime: completed ? 650 : 200,
            clearPercent: 80, thoughtCount: 0, mindStateLog: [], sessionDate: "2026-10-27",
            track: track, combined: combined
        )
    }

    func testCompletedCombinedSitAdvancesBothCounters() async throws {
        let store = makeStore()
        let session = try await store.createSession(request(completed: true, combined: true))
        XCTAssertEqual(session.combined, true)
        let me = try await store.me(today: "2026-10-27")
        let user = try XCTUnwrap(me)
        XCTAssertEqual(user.currentDay, 46)
        XCTAssertEqual(user.secondTrackDay, 11)
    }

    func testEndedEarlyCombinedSitAdvancesNeither() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: false, combined: true))
        let me = try await store.me(today: "2026-10-27")
        let user = try XCTUnwrap(me)
        XCTAssertEqual(user.currentDay, 45)
        XCTAssertEqual(user.secondTrackDay, 10)
    }

    /// An ordinary primary sit still moves Track One only.
    func testOrdinaryPrimarySitAdvancesTrackOneOnly() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: true, combined: false))
        let me = try await store.me(today: "2026-10-27")
        let user = try XCTUnwrap(me)
        XCTAssertEqual(user.currentDay, 46)
        XCTAssertEqual(user.secondTrackDay, 10)
    }

    func testCombinedSitCountsBothTracksDoneToday() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: true, combined: true))
        let done = try await store.getTracksDoneToday(date: "2026-10-27")
        XCTAssertTrue(done.primary)
        XCTAssertTrue(done.second)
    }

    func testEndedEarlyCombinedSitCountsNeitherTrackDoneToday() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: false, combined: true))
        let done = try await store.getTracksDoneToday(date: "2026-10-27")
        XCTAssertFalse(done.primary)
        XCTAssertFalse(done.second)
    }

    /// As `POST /api/sessions` does, a combined sit on Track Two is a 400 and
    /// saves nothing.
    func testCombinedSecondTrackSitIsRejected() async throws {
        let store = makeStore()
        do {
            _ = try await store.createSession(request(completed: true, combined: true, track: .second))
            XCTFail("expected a 400")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 400)
        }
        let me = try await store.me(today: "2026-10-27")
        let user = try XCTUnwrap(me)
        XCTAssertEqual(user.currentDay, 45)
        XCTAssertEqual(user.secondTrackDay, 10)
    }
}
