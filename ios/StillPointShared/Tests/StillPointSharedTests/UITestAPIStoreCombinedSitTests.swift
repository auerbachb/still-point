import Foundation
import Testing
@testable import StillPointShared

/// #896: `UITestAPIStore` mirrors the server's combined-sit rules (#890). A
/// completed combined sit advances both counters by one, an ended-early one
/// advances neither, and its done-today answer counts both tracks.
final class UITestAPIStoreCombinedSitTests {
    private let defaultsKey = "StillPoint.UnitTest.UITestAPIStore.\(UUID().uuidString)"

    deinit {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
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

    @Test func testCompletedCombinedSitAdvancesBothCounters() async throws {
        let store = makeStore()
        let session = try await store.createSession(request(completed: true, combined: true))
        #expect(session.combined == true)
        let me = try await store.me(today: "2026-10-27")
        let user = try #require(me)
        #expect(user.currentDay == 46)
        #expect(user.secondTrackDay == 11)
    }

    @Test func testEndedEarlyCombinedSitAdvancesNeither() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: false, combined: true))
        let me = try await store.me(today: "2026-10-27")
        let user = try #require(me)
        #expect(user.currentDay == 45)
        #expect(user.secondTrackDay == 10)
    }

    /// An ordinary primary sit still moves Track One only.
    @Test func testOrdinaryPrimarySitAdvancesTrackOneOnly() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: true, combined: false))
        let me = try await store.me(today: "2026-10-27")
        let user = try #require(me)
        #expect(user.currentDay == 46)
        #expect(user.secondTrackDay == 10)
    }

    @Test func testCombinedSitCountsBothTracksDoneToday() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: true, combined: true))
        let done = try await store.getTracksDoneToday(date: "2026-10-27")
        #expect(done.primary)
        #expect(done.second)
    }

    @Test func testEndedEarlyCombinedSitCountsNeitherTrackDoneToday() async throws {
        let store = makeStore()
        _ = try await store.createSession(request(completed: false, combined: true))
        let done = try await store.getTracksDoneToday(date: "2026-10-27")
        #expect(!done.primary)
        #expect(!done.second)
    }

    /// As `POST /api/sessions` does, a combined sit on Track Two is a 400 and
    /// saves nothing.
    @Test func testCombinedSecondTrackSitIsRejected() async throws {
        let store = makeStore()
        do {
            _ = try await store.createSession(request(completed: true, combined: true, track: .second))
            Issue.record("expected a 400")
        } catch let error as APIError {
            #expect(error.status == 400)
        }
        let me = try await store.me(today: "2026-10-27")
        let user = try #require(me)
        #expect(user.currentDay == 45)
        #expect(user.secondTrackDay == 10)
    }
}
