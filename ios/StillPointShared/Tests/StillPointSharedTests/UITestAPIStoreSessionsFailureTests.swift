import XCTest
@testable import StillPointShared

/// #957: the `SP_UI_TEST_FORCE_SESSIONS_FAILURE` modes of `UITestAPIStore`.
///
/// The once mode is what lets `testSessionsFailureShowsVisibleRetryMessage` tap
/// History's Retry and see the next load succeed, so its first-fails-then-succeeds
/// sequence is pinned here, alongside the always mode other tests rely on.
final class UITestAPIStoreSessionsFailureTests: XCTestCase {
    private var defaultsKey: String!

    private let today = "2026-01-15"

    override func setUp() {
        super.setUp()
        defaultsKey = "still-point.ui-test-store.tests.\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        defaultsKey = nil
        super.tearDown()
    }

    /// A fresh, signed-in store. `SP_UI_TEST_RESET_STORE=0` so building it does not
    /// clear the app's other persisted prefs; the unique key keeps it off any
    /// store a previous test left behind.
    private func makeStore(sessionsFailure: String?) throws -> UITestAPIStore {
        var environment = [
            "SP_UI_TEST_MODE": "1",
            "SP_UI_TEST_SEED_AUTH": "1",
            "SP_UI_TEST_RESET_STORE": "0",
        ]
        if let sessionsFailure {
            environment["SP_UI_TEST_FORCE_SESSIONS_FAILURE"] = sessionsFailure
        }
        return try XCTUnwrap(UITestAPIStore.make(environment: environment, defaultsKey: defaultsKey))
    }

    private func assertServerFailure(
        _ call: () async throws -> Void,
        _ message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            try await call()
            XCTFail("\(message): expected a 503, the call succeeded", file: file, line: line)
        } catch let error as APIError {
            XCTAssertEqual(error.status, 503, message, file: file, line: line)
        } catch {
            XCTFail("\(message): expected an APIError, got \(error)", file: file, line: line)
        }
    }

    func testOnceModeFailsFirstSessionsLoadThenSucceeds() async throws {
        let store = try makeStore(sessionsFailure: "once")

        await assertServerFailure({ _ = try await store.getSessions(today: self.today) }, "First History load")
        let retried = try await store.getSessions(today: today)
        XCTAssertTrue(retried.sessions.isEmpty)
        _ = try await store.getSessions(today: today)
    }

    func testOnceModeTracksRefreshDoesNotFailOrSpendTheFailure() async throws {
        let store = try makeStore(sessionsFailure: "once")

        _ = try await store.getTracksDoneToday(date: today)
        _ = try await store.getTracksDoneToday(date: today)
        await assertServerFailure(
            { _ = try await store.getSessions(today: self.today) },
            "History load after the track refresh"
        )
        _ = try await store.getSessions(today: today)
    }

    func testAlwaysModeFailsBothEndpointsOnEveryCall() async throws {
        let store = try makeStore(sessionsFailure: "1")

        for attempt in 1...3 {
            await assertServerFailure({ _ = try await store.getSessions(today: self.today) }, "getSessions \(attempt)")
            await assertServerFailure(
                { _ = try await store.getTracksDoneToday(date: self.today) },
                "getTracksDoneToday \(attempt)"
            )
        }
    }

    func testUnsetModeDoesNotFail() async throws {
        let store = try makeStore(sessionsFailure: nil)

        _ = try await store.getSessions(today: today)
        _ = try await store.getTracksDoneToday(date: today)
    }

    func testParseMapsValuesToModes() {
        for value in ["1", "true", "YES", "On"] {
            XCTAssertEqual(UITestSessionsFailureMode.parse(value), .always, value)
        }
        for value in ["once", "ONCE", "Once"] {
            XCTAssertEqual(UITestSessionsFailureMode.parse(value), .once, value)
        }
        for value in ["0", "", "false", " once", "twice"] {
            XCTAssertEqual(UITestSessionsFailureMode.parse(value), .none, value)
        }
        XCTAssertEqual(UITestSessionsFailureMode.parse(nil), .none)
    }
}
