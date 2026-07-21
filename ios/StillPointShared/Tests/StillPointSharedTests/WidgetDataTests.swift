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
            practiceDoneToday: true,
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
            secondDoneToday: false,
            practiceDoneToday: false
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
            practiceDoneToday: false,
            previous: nil
        )
        XCTAssertEqual(snapshot.currentDay, 1)
    }

    func testResolvedStreakIncrementsWhenPracticeDoneFlips() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 3,
            lastUpdated: now
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            practiceDoneToday: true,
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
            practiceDoneToday: true,
            streak: 8,
            lastUpdated: Date()
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "new-user",
            practiceDoneToday: false,
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
            practiceDoneToday: false,
            streak: 6,
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            practiceDoneToday: false,
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
            practiceDoneToday: true,
            streak: 6,
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            practiceDoneToday: false,
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
            practiceDoneToday: true,
            streak: 5,
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            practiceDoneToday: true,
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
            practiceDoneToday: true,
            streak: 6,
            lastUpdated: yesterday
        )

        let normalized = WidgetDataStore.normalizedForDisplay(stale, now: Date())
        XCTAssertFalse(normalized.isPracticeCompleteForToday(at: Date()))
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
            practiceDoneToday: true,
            streak: 9,
            lastUpdated: now
        )

        let snapshot = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 9)
    }

    // MARK: - #84 follow-up: weekday checkmark row

    private func session(
        date: String,
        type: SessionType = .standard,
        completed: Bool = true,
        track: Track? = .primary
    ) -> SessionDTO {
        SessionDTO(
            id: "\(date)-\(type.rawValue)-\(completed)-\(track?.rawValue ?? "nil")",
            dayNumber: 1,
            sessionType: type,
            duration: 60,
            completed: completed,
            actualTime: 60,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: date,
            buddySessionId: nil,
            track: track
        )
    }

    private func localDay(_ offset: Int, from now: Date = Date()) -> String {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: now)!
        return WidgetDataStore.localDayString(date)
    }

    /// Snapshots written before `completedDates` shipped must still decode.
    func testDecodesLegacyBlobWithoutCompletedDates() throws {
        let ref = Date(timeIntervalSince1970: 1_700_000_000)
        let legacy: [String: Any] = [
            "isLoggedIn": true,
            "userId": "u1",
            "currentDay": 10,
            "secondTrackDay": 2,
            "dualTrackEnabled": false,
            "primaryDoneToday": true,
            "secondDoneToday": false,
            "streak": 7,
            "lastUpdated": ref.timeIntervalSinceReferenceDate
        ]
        let data = try JSONSerialization.data(withJSONObject: legacy)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)
        XCTAssertEqual(decoded.completedDates, [])
        XCTAssertEqual(decoded.streak, 7)
        XCTAssertTrue(decoded.primaryDoneToday)
        XCTAssertTrue(decoded.practiceDoneToday, "legacy blobs fall back to primaryDoneToday")
    }

    func testRecentCompletedPracticeDatesFiltersTypeTrackAndWindow() {
        let now = Date()
        let today = localDay(0, from: now)
        let twoDaysAgo = localDay(-2, from: now)
        let tenDaysAgo = localDay(-10, from: now)

        let sessions = [
            session(date: today, type: .standard, completed: true, track: .primary),
            session(date: twoDaysAgo, type: .standard, completed: true, track: nil), // nil treated as primary
            session(date: tenDaysAgo, type: .standard, completed: true, track: .primary), // outside 7-day window
            session(date: today, type: .quick, completed: true, track: .primary), // quick counts (#589)
            session(date: twoDaysAgo, type: .breath, completed: true, track: nil), // breath counts (#589)
            session(date: today, type: .standard, completed: false, track: .primary), // incomplete excluded
            session(date: today, type: .standard, completed: true, track: .second) // second track excluded
        ]

        let result = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        XCTAssertEqual(result, [today, twoDaysAgo])
    }

    func testWeekMarksHasSevenDaysEndingToday() {
        let now = Date()
        let today = localDay(0, from: now)
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 5,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 3,
            completedDates: [today],
            lastUpdated: now
        )
        let marks = data.weekMarks(now: now)
        XCTAssertEqual(marks.count, 7)
        XCTAssertEqual(marks.last?.iso, today)
        XCTAssertEqual(marks.last?.isToday, true)
        XCTAssertEqual(marks.last?.done, true)
        XCTAssertEqual(marks.first?.isToday, false)
    }

    func testWeekMarksChecksTodayViaPracticeFlagWithoutCompletedDate() {
        let now = Date()
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 5,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 3,
            completedDates: [],
            lastUpdated: now
        )
        XCTAssertEqual(data.weekMarks(now: now).last?.done, true)
    }

    func testMakeSnapshotCarriesForwardHistoryWhenNoSessionsProvided() {
        let now = Date()
        let twoDaysAgo = localDay(-2, from: now)
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 12,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 4,
            completedDates: [twoDaysAgo],
            lastUpdated: now
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.completedDates, [twoDaysAgo])
    }

    func testMakeSnapshotFoldsTodayWhenPracticeDone() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        XCTAssertTrue(snapshot.completedDates.contains(localDay(0, from: now)))
    }

    func testMakeSnapshotUsesProvidedSessionsAsAuthoritative() {
        let now = Date()
        let today = localDay(0, from: now)
        let threeDaysAgo = localDay(-3, from: now)
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 12,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 4,
            completedDates: ["1999-01-01"], // stale; must be discarded
            lastUpdated: now
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous,
            completedPracticeDates: [today, threeDaysAgo]
        )
        XCTAssertEqual(Set(snapshot.completedDates), [today, threeDaysAgo])
    }

    func testMakeSnapshotDropsHistoryOnAccountSwitch() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "old-user",
            currentDay: 12,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 4,
            completedDates: [localDay(-2, from: now)],
            lastUpdated: now
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "new-user"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.completedDates, [])
    }

    func testNormalizedForDisplayPrunesHistoryOutsideWindow() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let inWindow = localDay(-2, from: now)
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 6,
            completedDates: ["2000-01-01", inWindow],
            lastUpdated: yesterday
        )
        let normalized = WidgetDataStore.normalizedForDisplay(data, now: now)
        XCTAssertEqual(normalized.completedDates, [inWindow])
    }

    /// Authoritative (session-derived) path must not inject today from a possibly
    /// stale `practiceDoneToday` flag — it trusts the fetched completion set.
    func testMakeSnapshotDoesNotFoldTodayWhenSessionsAuthoritative() {
        let now = Date()
        let today = localDay(0, from: now)
        let threeDaysAgo = localDay(-3, from: now)
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true, // stale flag; sessions say today is not complete
            now: now,
            previous: nil,
            completedPracticeDates: [threeDaysAgo]
        )
        XCTAssertFalse(snapshot.completedDates.contains(today))
        XCTAssertEqual(snapshot.completedDates, [threeDaysAgo])
    }

    /// Quick-only practice must extend widget streak (#589).
    func testMakeSnapshotIncrementsStreakForQuickOnlyDay() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 5,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 2,
            lastUpdated: now
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 3)
        XCTAssertTrue(snapshot.completedDates.contains(localDay(0, from: now)))
    }

    /// `localDayString` must emit Gregorian digits even when the supplied calendar
    /// is non-Gregorian, so keys match `sessionDate` (stamped Gregorian).
    func testLocalDayStringForcesGregorianDigits() {
        let date = Date(timeIntervalSince1970: 1_784_000_000) // ~2026
        var buddhist = Calendar(identifier: .buddhist)
        buddhist.timeZone = TimeZone(identifier: "UTC")!
        let iso = WidgetDataStore.localDayString(date, calendar: buddhist)
        XCTAssertEqual(iso.count, 10)
        XCTAssertTrue(iso.hasPrefix("20"), "expected Gregorian year, got \(iso)")
    }

    func testWeekMarksPopulateWeekdayName() {
        let now = Date()
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 5,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 3,
            completedDates: [],
            lastUpdated: now
        )
        XCTAssertFalse(data.weekMarks(now: now).last?.weekdayName.isEmpty ?? true)
    }
}
