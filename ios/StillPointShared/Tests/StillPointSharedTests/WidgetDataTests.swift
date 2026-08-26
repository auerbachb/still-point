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
            dayKeptToday: true,
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
            dayKeptToday: false,
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
            dayKeptToday: false,
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
            dayKeptToday: false,
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
            dayKeptToday: true,
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
        XCTAssertEqual(decoded.secondCompletedDates, [])
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
            session(date: today, type: .standard, completed: true, track: .second) // Track Two only (#684)
        ]

        let result = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        XCTAssertEqual(result.primary, [today, twoDaysAgo])
        // #684: the second-track standard sit lands on Track Two, never Track One.
        XCTAssertEqual(result.second, [today])
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

    // MARK: - #684: one row per sit on a two-a-day schedule

    private func dualTrackData(
        now: Date,
        completedDates: [String] = [],
        secondCompletedDates: [String] = [],
        primaryDoneToday: Bool = false,
        secondDoneToday: Bool = false,
        practiceDoneToday: Bool = false,
        streak: Int = 3
    ) -> WidgetData {
        WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 12,
            secondTrackDay: 4,
            dualTrackEnabled: true,
            primaryDoneToday: primaryDoneToday,
            secondDoneToday: secondDoneToday,
            practiceDoneToday: practiceDoneToday,
            streak: streak,
            completedDates: completedDates,
            secondCompletedDates: secondCompletedDates,
            lastUpdated: now
        )
    }

    func testCodableRoundTripPreservesBothTrackHistories() throws {
        let original = dualTrackData(
            now: Date(timeIntervalSince1970: 1_700_000_000),
            completedDates: ["2026-08-20"],
            secondCompletedDates: ["2026-08-21"]
        )
        let decoded = try JSONDecoder().decode(WidgetData.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(decoded, original)
        XCTAssertEqual(decoded.secondCompletedDates, ["2026-08-21"])
    }

    /// Snapshots written before the two-a-day rows shipped keep their history on
    /// Track One and start Track Two empty — no back-fill, no crash.
    func testDecodesPreDualTrackBlobIntoTrackOneOnly() throws {
        let ref = Date(timeIntervalSince1970: 1_700_000_000)
        let legacy: [String: Any] = [
            "isLoggedIn": true,
            "userId": "u1",
            "currentDay": 10,
            "secondTrackDay": 2,
            "dualTrackEnabled": true,
            "primaryDoneToday": true,
            "secondDoneToday": false,
            "practiceDoneToday": true,
            "streak": 7,
            "completedDates": ["2026-08-19", "2026-08-20"],
            "lastUpdated": ref.timeIntervalSinceReferenceDate
        ]
        let data = try JSONSerialization.data(withJSONObject: legacy)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)
        XCTAssertEqual(decoded.completedDates, ["2026-08-19", "2026-08-20"])
        XCTAssertEqual(decoded.secondCompletedDates, [])
        XCTAssertEqual(decoded.streak, 7)
    }

    func testSessionCountsForWidgetPracticeIsTrackAware() {
        let day = "2026-08-20"
        let primaryStandard = session(date: day, type: .standard, track: .primary)
        let secondStandard = session(date: day, type: .standard, track: .second)
        let quickOnSecond = session(date: day, type: .quick, track: .second)
        let untracked = session(date: day, type: .standard, track: nil)
        let incompleteSecond = session(date: day, type: .standard, completed: false, track: .second)

        XCTAssertTrue(WidgetDataStore.sessionCountsForWidgetPractice(primaryStandard, track: .primary))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(primaryStandard, track: .second))
        XCTAssertTrue(WidgetDataStore.sessionCountsForWidgetPractice(secondStandard, track: .second))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(secondStandard, track: .primary))
        // Quick and breath sits are Track One practice whatever track they carry.
        XCTAssertTrue(WidgetDataStore.sessionCountsForWidgetPractice(quickOnSecond, track: .primary))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(quickOnSecond, track: .second))
        // A session predating the dual-track fork is treated as primary.
        XCTAssertTrue(WidgetDataStore.sessionCountsForWidgetPractice(untracked, track: .primary))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(untracked, track: .second))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(incompleteSecond, track: .second))
        // The no-track overload keeps its pre-#684 Track One meaning.
        XCTAssertTrue(WidgetDataStore.sessionCountsForWidgetPractice(primaryStandard))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(secondStandard))
    }

    func testRecentCompletedPracticeDatesSplitsTracksOverSameWindow() {
        let now = Date()
        let today = localDay(0, from: now)
        let oneDayAgo = localDay(-1, from: now)
        let tenDaysAgo = localDay(-10, from: now)

        let sessions = [
            session(date: today, type: .standard, track: .second),
            session(date: oneDayAgo, type: .standard, track: .primary),
            session(date: oneDayAgo, type: .standard, track: .second),
            session(date: tenDaysAgo, type: .standard, track: .second), // outside the window
            session(date: today, type: .breath, track: .second) // breath is Track One practice
        ]

        let result = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        XCTAssertEqual(result.primary, [today, oneDayAgo])
        XCTAssertEqual(result.second, [today, oneDayAgo])
        XCTAssertFalse(result.second.contains(tenDaysAgo))
    }

    /// Completing one of the two sits checks that row for today — and only that
    /// row — without waiting for the other session.
    func testMakeSnapshotFoldsTodayIntoTheCompletedTrackOnly() {
        let now = Date()
        let today = localDay(0, from: now)
        let secondOnly = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: true,
            practiceDoneToday: false,
            now: now,
            previous: nil
        )
        XCTAssertEqual(secondOnly.secondCompletedDates, [today])
        XCTAssertEqual(secondOnly.completedDates, [])

        let bothTracks = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: true,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        XCTAssertEqual(bothTracks.completedDates, [today])
        XCTAssertEqual(bothTracks.secondCompletedDates, [today])
    }

    func testMakeSnapshotCarriesForwardBothTrackHistories() {
        let now = Date()
        let twoDaysAgo = localDay(-2, from: now)
        let threeDaysAgo = localDay(-3, from: now)
        let previous = dualTrackData(
            now: now,
            completedDates: [twoDaysAgo],
            secondCompletedDates: [threeDaysAgo]
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
        XCTAssertEqual(snapshot.secondCompletedDates, [threeDaysAgo])
    }

    func testMakeSnapshotReplacesSecondTrackHistoryAuthoritatively() {
        let now = Date()
        let threeDaysAgo = localDay(-3, from: now)
        let previous = dualTrackData(now: now, secondCompletedDates: ["1999-01-01"])
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous,
            secondCompletedPracticeDates: [threeDaysAgo, "1998-05-05"]
        )
        XCTAssertEqual(snapshot.secondCompletedDates, [threeDaysAgo])
    }

    func testMakeSnapshotDropsBothTrackHistoriesOnAccountSwitch() {
        let now = Date()
        var previous = dualTrackData(
            now: now,
            completedDates: [localDay(-1, from: now)],
            secondCompletedDates: [localDay(-2, from: now)]
        )
        previous.userId = "old-user"
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "new-user"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.completedDates, [])
        XCTAssertEqual(snapshot.secondCompletedDates, [])
    }

    func testNormalizedForDisplayPrunesBothTrackHistories() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let inWindow = localDay(-2, from: now)
        var data = dualTrackData(
            now: now,
            completedDates: ["2000-01-01", inWindow],
            secondCompletedDates: ["2000-01-02", inWindow],
            practiceDoneToday: true,
            streak: 6
        )
        data.lastUpdated = yesterday

        let normalized = WidgetDataStore.normalizedForDisplay(data, now: now)
        XCTAssertEqual(normalized.completedDates, [inWindow])
        XCTAssertEqual(normalized.secondCompletedDates, [inWindow])
        XCTAssertFalse(normalized.secondDoneToday)
    }

    // MARK: - #684 day-credit rule: at least one session keeps the day

    /// Finishing only the shorter (second) sit keeps the streak moving.
    func testStreakKeptWhenOnlySecondSessionCompleted() {
        let now = Date()
        let previous = dualTrackData(now: now, streak: 4)
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: true,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 5)
        XCTAssertTrue(snapshot.secondCompletedDates.contains(localDay(0, from: now)))
        XCTAssertFalse(snapshot.completedDates.contains(localDay(0, from: now)))
    }

    /// Continuity walks the union of both tracks: no day here has zero sits, so
    /// alternating between the two sessions still builds one streak.
    func testStreakWalksUnionOfBothTracks() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: true,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: [localDay(-3, from: now), localDay(-1, from: now)],
            secondCompletedPracticeDates: [localDay(-2, from: now), localDay(0, from: now)]
        )
        XCTAssertEqual(snapshot.streak, 4)
    }

    /// A day with zero sits still breaks continuity.
    func testStreakBreaksOnDayWithNoSitOnEitherTrack() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            // Yesterday and today are both empty: the run ended at -2.
            completedPracticeDates: [localDay(-3, from: now)],
            secondCompletedPracticeDates: [localDay(-2, from: now)]
        )
        XCTAssertEqual(snapshot.streak, 0)
    }

    /// Regression: the old carry-forward preserved a streak no matter how long
    /// the app had been closed. Two or more sit-free days must reset it.
    func testStreakResetsAfterMultiDayGap() {
        let now = Date()
        let fiveDaysAgo = Calendar.current.date(byAdding: .day, value: -5, to: now)!
        var previous = dualTrackData(
            now: now,
            completedDates: [localDay(-5, from: now)],
            primaryDoneToday: true,
            practiceDoneToday: true,
            streak: 9
        )
        previous.lastUpdated = fiveDaysAgo

        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 0)
    }

    /// The 7-day window is a lower bound, not a cap: a longer streak carried in
    /// the previous snapshot survives an unbroken week of history.
    func testStreakLongerThanWindowSurvives() {
        let now = Date()
        let previous = dualTrackData(
            now: now,
            completedDates: WidgetDataStore.localDayStrings(lastN: 7, endingAt: now),
            primaryDoneToday: true,
            practiceDoneToday: true,
            streak: 30
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 30)
    }

    func testIsDayKeptTodayHonorsEitherTrack() {
        let now = Date()
        XCTAssertTrue(dualTrackData(now: now, secondDoneToday: true).isDayKeptToday(at: now))
        XCTAssertTrue(dualTrackData(now: now, practiceDoneToday: true).isDayKeptToday(at: now))
        XCTAssertFalse(dualTrackData(now: now).isDayKeptToday(at: now))
    }

    // MARK: - #684 per-track weekday rows

    func testWeekMarksPerTrackReflectOnlyTheirOwnCompletions() {
        let now = Date()
        let oneDayAgo = localDay(-1, from: now)
        let twoDaysAgo = localDay(-2, from: now)
        let data = dualTrackData(
            now: now,
            completedDates: [oneDayAgo],
            secondCompletedDates: [twoDaysAgo]
        )

        let trackOne = data.weekMarks(for: .primary, now: now)
        let trackTwo = data.weekMarks(for: .second, now: now)
        XCTAssertEqual(trackOne.count, 7)
        XCTAssertEqual(trackTwo.count, 7)
        XCTAssertEqual(trackOne.first(where: { $0.iso == oneDayAgo })?.done, true)
        XCTAssertEqual(trackOne.first(where: { $0.iso == twoDaysAgo })?.done, false)
        XCTAssertEqual(trackTwo.first(where: { $0.iso == twoDaysAgo })?.done, true)
        XCTAssertEqual(trackTwo.first(where: { $0.iso == oneDayAgo })?.done, false)

        // The single-row layout keeps showing a day kept by either track.
        let union = data.weekMarks(now: now)
        XCTAssertEqual(union.first(where: { $0.iso == oneDayAgo })?.done, true)
        XCTAssertEqual(union.first(where: { $0.iso == twoDaysAgo })?.done, true)
    }

    func testWeekMarksPerTrackUseTheirOwnDoneTodayFallback() {
        let now = Date()
        let data = dualTrackData(now: now, secondDoneToday: true)
        XCTAssertEqual(data.weekMarks(for: .primary, now: now).last?.done, false)
        XCTAssertEqual(data.weekMarks(for: .second, now: now).last?.done, true)
        XCTAssertEqual(data.weekMarks(now: now).last?.done, true)
    }

    /// Days practised before the switch to two-a-day render on Track One only.
    func testPreSwitchHistoryRendersOnTrackOneOnly() {
        let now = Date()
        let preSwitch = [localDay(-5, from: now), localDay(-4, from: now)]
        let data = dualTrackData(
            now: now,
            completedDates: preSwitch,
            secondCompletedDates: [localDay(-1, from: now)]
        )
        let trackTwo = data.weekMarks(for: .second, now: now)
        for iso in preSwitch {
            XCTAssertEqual(trackTwo.first(where: { $0.iso == iso })?.done, false)
        }
        let trackOne = data.weekMarks(for: .primary, now: now)
        for iso in preSwitch {
            XCTAssertEqual(trackOne.first(where: { $0.iso == iso })?.done, true)
        }
    }

    /// A single-session setup has no Track Two history, so its row is unchanged.
    func testSingleTrackSetupRendersOneUnchangedRow() {
        let now = Date()
        let oneDayAgo = localDay(-1, from: now)
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
            completedDates: [oneDayAgo],
            lastUpdated: now
        )
        XCTAssertEqual(data.secondCompletedDates, [])
        XCTAssertEqual(data.weekMarks(now: now), data.weekMarks(for: .primary, now: now))
        XCTAssertEqual(data.weekMarks(now: now).first(where: { $0.iso == oneDayAgo })?.done, true)
    }
}
