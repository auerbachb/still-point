import XCTest
import StillPointShared

final class WidgetDataTests: XCTestCase {
    private func makeUser(id: String = "user-1", currentDay: Int = 12) -> UserDTO {
        UserDTO(
            id: id,
            email: "test@example.com",
            username: "tester",
            isPublic: false,
            currentDay: currentDay
        )
    }

    func testCodableRoundTrip() throws {
        let original = WidgetData(
            isLoggedIn: true,
            userId: "abc",
            currentDay: 7,
            secondTrackDay: 3,
            dualTrackEnabled: true,
            primaryDoneToday: true,
            secondDoneToday: false,
            streak: 5,
            lastUpdated: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)
        XCTAssertEqual(decoded, original)
    }

    func testMakeSnapshotLoggedOut() {
        let snapshot = WidgetDataStore.makeSnapshot(
            user: nil,
            primaryDoneToday: false,
            secondDoneToday: false
        )
        XCTAssertEqual(snapshot, .loggedOut)
    }

    func testMakeSnapshotUsesClampedDay() {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "a",
            isPublic: false,
            currentDay: 0
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            previous: nil
        )
        XCTAssertEqual(snapshot.currentDay, 1)
    }

    func testResolvedStreakIncrementsWhenPrimaryDoneFlips() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            streak: 3,
            lastUpdated: now
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            primaryDoneToday: true,
            previous: previous,
            now: now
        )
        XCTAssertEqual(streak, 4)
    }

    func testResolvedStreakResetsOnAccountSwitch() {
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "old-user",
            currentDay: 10,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            streak: 8,
            lastUpdated: Date()
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "new-user",
            primaryDoneToday: false,
            previous: previous
        )
        XCTAssertEqual(streak, 0)
    }

    func testResolvedStreakResetsOnNewLocalDayWithoutCompletion() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            streak: 6,
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            primaryDoneToday: false,
            previous: previous,
            now: Date()
        )
        XCTAssertEqual(streak, 0)
    }

    func testResolvedStreakPreservesOnNewDayAfterYesterdayComplete() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            streak: 6,
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            primaryDoneToday: false,
            previous: previous,
            now: Date()
        )
        XCTAssertEqual(streak, 6)
    }

    func testResolvedStreakIncrementsOnNewDayWhenAlreadyDone() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            streak: 5,
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            primaryDoneToday: true,
            previous: previous,
            now: now
        )
        XCTAssertEqual(streak, 6)
    }

    func testNormalizedForDisplayClearsStaleDoneToday() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let stale = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            streak: 6,
            lastUpdated: yesterday
        )

        let normalized = WidgetDataStore.normalizedForDisplay(stale, now: Date())
        XCTAssertFalse(normalized.isPrimaryCompleteForToday(at: Date()))
        XCTAssertEqual(normalized.streak, 6)
    }

    func testMakeSnapshotPreservesStreakSameDay() {
        let now = Date()
        let user = makeUser()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: user.id,
            currentDay: 12,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            streak: 9,
            lastUpdated: now
        )

        let snapshot = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: true,
            secondDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 9)
    }
}
