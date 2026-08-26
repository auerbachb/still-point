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

    // MARK: - #671: streak derived from history, never from flag transitions

    func testHistoryStreakCountsRunEndingToday() {
        let now = Date()
        let dates = (0...3).map { localDay(-$0, from: now) }
        XCTAssertEqual(WidgetDataStore.historyStreak(completedDates: dates, now: now), 4)
    }

    func testHistoryStreakCountsRunEndingYesterdayWhenTodayPending() {
        let now = Date()
        let dates = (1...3).map { localDay(-$0, from: now) }
        XCTAssertEqual(WidgetDataStore.historyStreak(completedDates: dates, now: now), 3)
    }

    func testHistoryStreakIsZeroWhenYesterdayMissedAndTodayPending() {
        let now = Date()
        let dates = (2...4).map { localDay(-$0, from: now) }
        XCTAssertEqual(WidgetDataStore.historyStreak(completedDates: dates, now: now), 0)
    }

    func testHistoryStreakStopsAtFirstGap() {
        let now = Date()
        // Today, yesterday complete; two days ago missed; older days complete.
        let dates = [localDay(0, from: now), localDay(-1, from: now), localDay(-3, from: now)]
        XCTAssertEqual(WidgetDataStore.historyStreak(completedDates: dates, now: now), 2)
    }

    func testHistoryStreakUsesPracticeFlagForTodayWithoutCompletedDate() {
        let now = Date()
        let dates = (1...2).map { localDay(-$0, from: now) }
        XCTAssertEqual(
            WidgetDataStore.historyStreak(completedDates: dates, practiceDoneToday: true, now: now),
            3
        )
    }

    /// The exact case in the #671 screenshot: six consecutive completed days
    /// ending yesterday with today still pending must read 6, not the 2 the old
    /// flag-transition counter accumulated.
    func testSixCompletedDaysWithTodayPendingYieldsStreakSix() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 2, // the wrong number the widget used to carry
            completedDates: (1...6).map { localDay(-$0, from: now) },
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
        XCTAssertEqual(snapshot.streak, 6)
        XCTAssertEqual(snapshot.weekRowStreak(now: now), 6)
    }

    func testServerStreakExtendsRunPastTheWindowEdge() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: Set((1...6).map { localDay(-$0, from: now) }),
            serverStreak: 20,
            serverStreakDate: localDay(-1, from: now)
        )
        XCTAssertEqual(snapshot.streak, 20)
    }

    /// A gap the row can see always wins: `/api/sessions` reports the run ending
    /// at the latest recorded day, which stays non-zero long after a lapse.
    func testServerStreakCannotOverrideAVisibleGap() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: Set((1...3).map { localDay(-$0, from: now) }),
            serverStreak: 20,
            serverStreakDate: localDay(-1, from: now)
        )
        XCTAssertEqual(snapshot.streak, 3)
    }

    func testServerStreakIgnoredWhenAnchorPredatesTheRun() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: Set((1...6).map { localDay(-$0, from: now) }),
            serverStreak: 20,
            serverStreakDate: localDay(-30, from: now) // stale; outside the row
        )
        XCTAssertEqual(snapshot.streak, 6)
    }

    /// Sitting today must move the flame even when the streak is older than the
    /// row — the carried-forward anchor supplies the days the row can't show.
    func testSitTodayExtendsCarriedForwardServerStreak() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 20,
            completedDates: (1...6).map { localDay(-$0, from: now) },
            serverStreak: 20,
            serverStreakDate: localDay(-1, from: now),
            lastUpdated: now
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 21)
        XCTAssertEqual(snapshot.serverStreak, 20, "anchor carries forward for the next sit")
    }

    func testMakeSnapshotDropsServerAnchorOnAccountSwitch() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "old-user",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 20,
            completedDates: (1...6).map { localDay(-$0, from: now) },
            serverStreak: 20,
            serverStreakDate: localDay(-1, from: now),
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
        XCTAssertEqual(snapshot.streak, 0)
        XCTAssertNil(snapshot.serverStreak)
        XCTAssertNil(snapshot.serverStreakDate)
    }

    func testServerStreakAnchorDateIsLatestCompletedStandardSit() {
        let now = Date()
        let sessions = [
            session(date: localDay(-4, from: now), type: .standard, completed: true),
            session(date: localDay(-2, from: now), type: .standard, completed: true),
            session(date: localDay(-1, from: now), type: .standard, completed: false),
            session(date: localDay(0, from: now), type: .quick, completed: true)
        ]
        XCTAssertEqual(
            WidgetDataStore.serverStreakAnchorDate(from: sessions),
            localDay(-2, from: now)
        )
    }

    func testServerStreakAnchorDateIsNilWithoutCompletedStandardSit() {
        let now = Date()
        let sessions = [session(date: localDay(0, from: now), type: .breath, completed: true)]
        XCTAssertNil(WidgetDataStore.serverStreakAnchorDate(from: sessions))
    }

    // MARK: - #671: day rollover

    func testNormalizedForDisplayClearsStaleDoneToday() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
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
            completedDates: (1...6).map { localDay(-$0, from: now) },
            lastUpdated: yesterday
        )

        let normalized = WidgetDataStore.normalizedForDisplay(stale, now: now)
        XCTAssertFalse(normalized.isPracticeCompleteForToday(at: now))
        XCTAssertFalse(normalized.primaryDoneToday)
        XCTAssertFalse(normalized.secondDoneToday)
        XCTAssertEqual(normalized.streak, 6, "an intact streak survives the rollover")
    }

    /// The regression #671 AC3 names: the rollover branch zeroed the streak
    /// whenever the previous snapshot's `practiceDoneToday` was false, even when
    /// history plainly showed the streak was intact.
    func testNormalizedForDisplayKeepsStreakWhenPriorSnapshotHadNotSatYet() {
        let now = Date()
        let yesterdayMorning = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false, // snapshot written before yesterday's sit
            streak: 5,
            completedDates: (1...5).map { localDay(-$0, from: now) },
            lastUpdated: yesterdayMorning
        )
        XCTAssertEqual(WidgetDataStore.normalizedForDisplay(data, now: now).streak, 5)
    }

    func testNormalizedForDisplayZeroesStreakWhenRowShowsALapse() {
        let now = Date()
        let threeDaysAgo = Calendar.current.date(byAdding: .day, value: -3, to: now)!
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 12,
            completedDates: (3...5).map { localDay(-$0, from: now) },
            serverStreak: 12,
            serverStreakDate: localDay(-3, from: now),
            lastUpdated: threeDaysAgo
        )
        let normalized = WidgetDataStore.normalizedForDisplay(data, now: now)
        XCTAssertEqual(normalized.streak, 0)
        XCTAssertEqual(normalized.weekRowStreak(now: now), 0)
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
            streak: 7,
            completedDates: (0...6).map { localDay(-$0, from: now) },
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
        XCTAssertEqual(snapshot.streak, 7)
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
        XCTAssertEqual(result.primary, [today, twoDaysAgo])
        XCTAssertEqual(result.second, [today], "the second-track standard sit lands on Track Two (#684)")
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
            completedDates: (1...2).map { localDay(-$0, from: now) },
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

    // MARK: - #671 symptom 2: the stored week must survive a failed launch

    /// Root cause of "the week resets": `syncWidgetData()` wiped the shared blob
    /// on *any* signed-out render, including a launch that merely couldn't reach
    /// the server. Only an authoritative sign-out may clear it.
    func testOnlyAuthoritativeSignOutClearsTheStoredSnapshot() {
        XCTAssertTrue(WidgetDataStore.shouldClearStoredSnapshot(on: .signedOut))
        XCTAssertTrue(WidgetDataStore.shouldClearStoredSnapshot(on: .unauthorized))
        XCTAssertFalse(
            WidgetDataStore.shouldClearStoredSnapshot(on: .unreachable),
            "an offline cold start is not a sign-out"
        )
        XCTAssertFalse(
            WidgetDataStore.shouldClearStoredSnapshot(on: .serverError),
            "a 500 says nothing about the session"
        )
    }

    /// The damage a wipe does, and why it looks like the row "reset": with no
    /// prior snapshot to carry forward, the network-free sync path has nothing to
    /// build a week from, so both the row and the streak start over.
    func testWipedSnapshotLeavesTheRowBlankAndTheStreakAtZero() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil // the blob a failed launch had already cleared
        )
        XCTAssertEqual(snapshot.completedDates, [])
        XCTAssertEqual(snapshot.streak, 0)
        XCTAssertEqual(snapshot.weekMarks(now: now).filter(\.done).count, 0)
    }

    // MARK: - #671 symptom 2: the week must not reset at a calendar boundary

    /// Fixed `now` on a Monday with completions the preceding Wed–Sun: those days
    /// belong to the *previous* calendar week but are inside the trailing seven,
    /// so they must stay marked.
    func testWeekBoundaryKeepsPriorCalendarWeekMarked() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        // 2026-03-16 is a Monday.
        let monday = ISO8601DateFormatter().date(from: "2026-03-16T12:00:00Z")!
        XCTAssertEqual(calendar.component(.weekday, from: monday), 2, "fixture must be a Monday")

        let priorWeek = ["2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"] // Wed–Sun
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 5,
            completedDates: priorWeek,
            lastUpdated: monday
        )

        let marks = data.weekMarks(now: monday, calendar: calendar)
        let done = Set(marks.filter(\.done).map(\.iso))
        XCTAssertEqual(done, Set(priorWeek), "prior-week completions must survive the boundary")
        XCTAssertEqual(marks.last?.iso, "2026-03-16")
        XCTAssertEqual(marks.last?.done, false, "Monday is still pending")
        XCTAssertEqual(
            WidgetDataStore.reconciledStreak(
                completedDates: priorWeek,
                serverStreak: nil,
                serverStreakDate: nil,
                now: monday,
                calendar: calendar
            ),
            5
        )
    }

    /// A snapshot written last week must still carry its history forward through
    /// the network-free sync path once the calendar week rolls over.
    func testMakeSnapshotCarriesHistoryAcrossAWeekBoundary() {
        let now = Date()
        let priorDays = (1...5).map { localDay(-$0, from: now) }
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 5,
            completedDates: priorDays,
            lastUpdated: Calendar.current.date(byAdding: .day, value: -1, to: now)!
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(Set(snapshot.completedDates), Set(priorDays))
        XCTAssertEqual(snapshot.streak, 5)
    }

    /// #671 AC6: a cold start with no network keeps the last known history —
    /// `normalizedForDisplay` is the widget's only read path, and it must never
    /// blank the row or zero an intact streak.
    func testColdStartWithoutNetworkKeepsLastKnownHistory() {
        let now = Date()
        let lastSeen = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let stored = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 4,
            completedDates: (1...4).map { localDay(-$0, from: now) },
            lastUpdated: lastSeen
        )
        let displayed = WidgetDataStore.normalizedForDisplay(stored, now: now)
        XCTAssertEqual(displayed.completedDates.count, 4)
        XCTAssertEqual(displayed.weekMarks(now: now).filter(\.done).count, 4)
        XCTAssertEqual(displayed.streak, 4)
    }

    // MARK: - #671 AC2 × #684: streak and the rendered rows cannot disagree

    /// Property check over generated completion sets, ported to the two-a-day row
    /// model (#684): whatever the widget shows as `streak`, it can never
    /// contradict the run its own rows draw.
    ///
    /// Under the day-credit rule a day is *shown* as kept when **either** row
    /// marks it, so the union row `weekMarks(now:)` is exactly the run a person
    /// counts off the widget with their finger — one row on a single-session
    /// setup, the two rows read together on a two-a-day one. The sweep therefore
    /// asserts both halves: that the rendered rows really do partition the kept
    /// days between them, and that the number beside them never exceeds what
    /// they show unless the run leaves the window.
    func testStreakNeverContradictsTheRenderedRow() {
        let now = Date()
        let serverCases: [(Int?, String?)] = [
            (nil, nil),
            (20, localDay(-1, from: now)),
            (20, localDay(0, from: now)),
            (20, localDay(-30, from: now)),
            (3, localDay(-2, from: now))
        ]

        // Every subset of the trailing seven days, against every server anchor.
        for mask in 0..<(1 << 7) {
            let offsets = (0..<7).filter { mask & (1 << $0) != 0 }
            // Split the kept days across the tracks so all three shapes occur in
            // every mask: Track One only, Track Two only, and both. The union is
            // unchanged by the split — which is the point, since day credit does
            // not care which of the two sits landed.
            let primaryDates = offsets.filter { $0 % 3 != 1 }.map { localDay(-$0, from: now) }
            let secondDates = offsets.filter { $0 % 3 != 0 }.map { localDay(-$0, from: now) }
            let keptDays = Set(offsets.map { localDay(-$0, from: now) })

            func snapshot(serverStreak: Int?, serverStreakDate: String?) -> WidgetData {
                WidgetDataStore.normalizedForDisplay(
                    WidgetData(
                        isLoggedIn: true,
                        userId: "u1",
                        currentDay: 30,
                        secondTrackDay: 4,
                        dualTrackEnabled: true,
                        primaryDoneToday: false,
                        secondDoneToday: false,
                        practiceDoneToday: false,
                        streak: 999, // deliberately wrong; display must re-derive it
                        completedDates: primaryDates,
                        secondCompletedDates: secondDates,
                        serverStreak: serverStreak,
                        serverStreakDate: serverStreakDate,
                        lastUpdated: now
                    ),
                    now: now
                )
            }

            // The rendered rows, between them, show exactly the kept days — and
            // neither row ever marks a day its own track did not sit. None of
            // this depends on the server anchor, so it is asserted once per mask.
            let rendered = snapshot(serverStreak: nil, serverStreakDate: nil)
            let rowOne = Set(rendered.weekMarks(for: .primary, now: now).filter(\.done).map(\.iso))
            let rowTwo = Set(rendered.weekMarks(for: .second, now: now).filter(\.done).map(\.iso))
            let unionRow = Set(rendered.weekMarks(now: now).filter(\.done).map(\.iso))
            XCTAssertEqual(unionRow, rowOne.union(rowTwo), "union row is not what the rows show (mask=\(mask))")
            XCTAssertEqual(unionRow, keptDays, "the rendered rows lost a kept day (mask=\(mask))")
            XCTAssertTrue(
                rowOne.isSubset(of: Set(primaryDates)),
                "Track One marked a day it did not sit (mask=\(mask))"
            )
            XCTAssertTrue(
                rowTwo.isSubset(of: Set(secondDates)),
                "Track Two marked a day it did not sit (mask=\(mask))"
            )

            for (serverStreak, serverStreakDate) in serverCases {
                let shown = snapshot(serverStreak: serverStreak, serverStreakDate: serverStreakDate)
                let context = "mask=\(mask) server=\(String(describing: serverStreak))"
                let rowRun = shown.weekRowStreak(now: now)
                // Rows with no run mean no streak — nothing may inflate it.
                if rowRun == 0 {
                    XCTAssertEqual(shown.streak, 0, "streak must be 0 when the rows show none (\(context))")
                    continue
                }
                // The streak may never undercount days the rows visibly show.
                XCTAssertGreaterThanOrEqual(shown.streak, rowRun, "streak below the rows (\(context))")
                // When the rows can see where the run began, the streak must match
                // exactly — only a run that leaves the window may exceed it.
                if !shown.weekRowStreakReachesWindowEdge(now: now) {
                    XCTAssertEqual(shown.streak, rowRun, "streak exceeds a visibly broken row (\(context))")
                }
            }
        }
    }

    func testWeekRowStreakReadsTheRenderedMarks() {
        let now = Date()
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 0,
            completedDates: [localDay(-1, from: now), localDay(-2, from: now), localDay(-4, from: now)],
            lastUpdated: now
        )
        XCTAssertEqual(data.weekRowStreak(now: now), 2)
        XCTAssertFalse(data.weekRowStreakReachesWindowEdge(now: now))
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
    ///
    /// #671 note: the previous snapshot carries the four days the run is built
    /// from. A carried number with no history behind it is exactly what this PR
    /// stops the widget displaying, so the fixture supplies the evidence the row
    /// would be drawing.
    func testStreakKeptWhenOnlySecondSessionCompleted() {
        let now = Date()
        let previous = dualTrackData(
            now: now,
            completedDates: (1...4).map { localDay(-$0, from: now) },
            streak: 4
        )
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

    /// …and it keeps counting: a sit today on a week the rows show unbroken
    /// advances the carried total rather than collapsing to the window length.
    func testCarriedStreakLongerThanWindowIncrementsAcrossADay() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        var previous = dualTrackData(
            now: now,
            completedDates: (1...7).map { localDay(-$0, from: now) },
            primaryDoneToday: true,
            practiceDoneToday: true,
            streak: 30
        )
        previous.lastUpdated = yesterday

        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: true, // only the second sit today — still a kept day
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(snapshot.streak, 31)
    }

    /// #671 × #684: the carried total is a *candidate*, never an override. When
    /// the rows show where the run actually broke, the number beside them is the
    /// run they draw — no matter what the previous snapshot claimed.
    func testCarriedStreakIsIgnoredWhenTheRowsShowABreak() {
        let now = Date()
        let previous = dualTrackData(
            now: now,
            completedDates: [localDay(-1, from: now)],
            secondCompletedDates: [localDay(-4, from: now)],
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
        // Today and yesterday are kept; -2 and -3 are blank, and the rows say so.
        XCTAssertEqual(snapshot.streak, 2)
        XCTAssertEqual(snapshot.weekRowStreak(now: now), 2)
    }

    func testIsDayKeptTodayHonorsEitherTrack() {
        let now = Date()
        XCTAssertTrue(dualTrackData(now: now, secondDoneToday: true).isDayKeptToday(at: now))
        XCTAssertTrue(dualTrackData(now: now, practiceDoneToday: true).isDayKeptToday(at: now))
        XCTAssertFalse(dualTrackData(now: now).isDayKeptToday(at: now))
    }

    // MARK: - #684 carry-forward, bounded by the #671 row invariant

    /// Every case below feeds `resolvedStreak` the history the rows would be
    /// drawing, because the carried value is only admissible while the rows
    /// corroborate an unbroken run back to the oldest column. With no history at
    /// all the rows are blank, and a blank row may never carry a streak.

    func testResolvedStreakIncrementsWhenPracticeDoneFlips() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 30,
            completedDates: (1...6).map { localDay(-$0, from: now) },
            lastUpdated: now
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            dayKeptToday: true,
            previous: previous,
            now: now,
            completedDays: Set((0...6).map { localDay(-$0, from: now) })
        )
        XCTAssertEqual(streak, 31)
    }

    func testResolvedStreakResetsOnAccountSwitch() {
        let now = Date()
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
            completedDates: (0...6).map { localDay(-$0, from: now) },
            lastUpdated: now
        )

        // The other account's history never reaches this call either, so the rows
        // the new account renders are blank and the streak is zero.
        let streak = WidgetDataStore.resolvedStreak(
            userId: "new-user",
            dayKeptToday: false,
            previous: previous,
            now: now
        )
        XCTAssertEqual(streak, 0)
    }

    func testResolvedStreakResetsOnNewLocalDayWithoutCompletion() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
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
            completedDates: [],
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            dayKeptToday: false,
            previous: previous,
            now: now
        )
        XCTAssertEqual(streak, 0)
    }

    func testResolvedStreakPreservesOnNewDayAfterYesterdayComplete() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let history = (1...7).map { localDay(-$0, from: now) }
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 20,
            completedDates: history,
            lastUpdated: yesterday
        )

        // Today is still pending, so the run ends yesterday and reaches the oldest
        // column — the rows cannot see where it began, so the carried 20 stands.
        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            dayKeptToday: false,
            previous: previous,
            now: now,
            completedDays: Set(history)
        )
        XCTAssertEqual(streak, 20)
    }

    func testResolvedStreakIncrementsOnNewDayWhenAlreadyDone() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 20,
            completedDates: (1...7).map { localDay(-$0, from: now) },
            lastUpdated: yesterday
        )

        let streak = WidgetDataStore.resolvedStreak(
            userId: "u1",
            dayKeptToday: true,
            previous: previous,
            now: now,
            completedDays: Set((0...6).map { localDay(-$0, from: now) })
        )
        XCTAssertEqual(streak, 21)
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
