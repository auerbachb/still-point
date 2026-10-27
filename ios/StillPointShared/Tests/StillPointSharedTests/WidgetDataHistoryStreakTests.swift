import Foundation
import Testing
import StillPointShared

struct WidgetDataHistoryStreakTests: WidgetDataTestSupport {
    // MARK: - #671: streak derived from history, never from flag transitions

    @Test func testHistoryStreakCountsRunEndingToday() {
        let now = Date()
        let dates = (0...3).map { localDay(-$0, from: now) }
        #expect(WidgetDataStore.historyStreak(completedDates: dates, now: now) == 4)
    }

    @Test func testHistoryStreakCountsRunEndingYesterdayWhenTodayPending() {
        let now = Date()
        let dates = (1...3).map { localDay(-$0, from: now) }
        #expect(WidgetDataStore.historyStreak(completedDates: dates, now: now) == 3)
    }

    @Test func testHistoryStreakIsZeroWhenYesterdayMissedAndTodayPending() {
        let now = Date()
        let dates = (2...4).map { localDay(-$0, from: now) }
        #expect(WidgetDataStore.historyStreak(completedDates: dates, now: now) == 0)
    }

    @Test func testHistoryStreakStopsAtFirstGap() {
        let now = Date()
        // Today, yesterday complete; two days ago missed; older days complete.
        let dates = [localDay(0, from: now), localDay(-1, from: now), localDay(-3, from: now)]
        #expect(WidgetDataStore.historyStreak(completedDates: dates, now: now) == 2)
    }

    @Test func testHistoryStreakUsesPracticeFlagForTodayWithoutCompletedDate() {
        let now = Date()
        let dates = (1...2).map { localDay(-$0, from: now) }
        #expect(WidgetDataStore.historyStreak(completedDates: dates, practiceDoneToday: true, now: now) == 3)
    }

    /// The exact case in the #671 screenshot: six consecutive completed days
    /// ending yesterday with today still pending must read 6, not the 2 the old
    /// flag-transition counter accumulated.
    @Test func testSixCompletedDaysWithTodayPendingYieldsStreakSix() {
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
        #expect(snapshot.streak == 6)
        #expect(snapshot.weekRowStreak(now: now) == 6)
    }

    @Test func testServerStreakExtendsRunPastTheWindowEdge() {
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
        #expect(snapshot.streak == 20)
    }

    /// A gap the row can see always wins: `/api/sessions` reports the run ending
    /// at the latest recorded day, which stays non-zero long after a lapse.
    @Test func testServerStreakCannotOverrideAVisibleGap() {
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
        #expect(snapshot.streak == 3)
    }

    @Test func testServerStreakIgnoredWhenAnchorPredatesTheRun() {
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
        #expect(snapshot.streak == 6)
    }

    /// Sitting today must move the flame even when the streak is older than the
    /// row — the carried-forward anchor supplies the days the row can't show.
    @Test func testSitTodayExtendsCarriedForwardServerStreak() {
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
        #expect(snapshot.streak == 21)
        #expect(snapshot.serverStreak == 20, "anchor carries forward for the next sit")
    }

    @Test func testMakeSnapshotDropsServerAnchorOnAccountSwitch() {
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
        #expect(snapshot.streak == 0)
        #expect(snapshot.serverStreak == nil)
        #expect(snapshot.serverStreakDate == nil)
    }

    @Test func testServerStreakAnchorDateIsLatestCompletedStandardSit() {
        let now = Date()
        let sessions = [
            session(date: localDay(-4, from: now), type: .standard, completed: true),
            session(date: localDay(-2, from: now), type: .standard, completed: true),
            session(date: localDay(-1, from: now), type: .standard, completed: false),
            session(date: localDay(0, from: now), type: .quick, completed: true)
        ]
        #expect(WidgetDataStore.serverStreakAnchorDate(from: sessions) == localDay(-2, from: now))
    }

    @Test func testServerStreakAnchorDateIsNilWithoutCompletedStandardSit() {
        let now = Date()
        let sessions = [session(date: localDay(0, from: now), type: .breath, completed: true)]
        #expect(WidgetDataStore.serverStreakAnchorDate(from: sessions) == nil)
    }

    // MARK: - #671: day rollover

    @Test func testNormalizedForDisplayClearsStaleDoneToday() {
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
        #expect(!normalized.isPracticeCompleteForToday(at: now))
        #expect(!normalized.primaryDoneToday)
        #expect(!normalized.secondDoneToday)
        #expect(normalized.streak == 6, "an intact streak survives the rollover")
    }

    /// The regression #671 AC3 names: the rollover branch zeroed the streak
    /// whenever the previous snapshot's `practiceDoneToday` was false, even when
    /// history plainly showed the streak was intact.
    @Test func testNormalizedForDisplayKeepsStreakWhenPriorSnapshotHadNotSatYet() {
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
        #expect(WidgetDataStore.normalizedForDisplay(data, now: now).streak == 5)
    }

    @Test func testNormalizedForDisplayZeroesStreakWhenRowShowsALapse() {
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
        #expect(normalized.streak == 0)
        #expect(normalized.weekRowStreak(now: now) == 0)
    }

    @Test func testMakeSnapshotPreservesStreakSameDay() {
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
        #expect(snapshot.streak == 7)
    }

    /// #767: an unfinished practice day stays open from midnight until 6:00 local.
    /// A finished day still rolls at midnight.
    @Test func testUnfinishedPracticeDayStaysOpenUntil6am() {
        let calendar = Calendar.current
        func at(_ hour: Int, _ minute: Int, day: Int) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
        }
        let yesterdayEvening = at(23, 0, day: 7)
        let twelveThirty = at(0, 30, day: 8)
        let sixAm = at(6, 0, day: 8)

        let unfinished = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 1,
            lastUpdated: yesterdayEvening
        )
        #expect(WidgetDataStore.normalizedForDisplay(unfinished, now: twelveThirty).practiceDoneToday)
        #expect(!WidgetDataStore.normalizedForDisplay(unfinished, now: sixAm).practiceDoneToday)

        let finished = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 4,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 1,
            lastUpdated: yesterdayEvening
        )
        #expect(!WidgetDataStore.normalizedForDisplay(finished, now: twelveThirty).primaryDoneToday)
    }

    // MARK: - #671 symptom 2: the stored week must survive a failed launch

    /// Root cause of "the week resets": `syncWidgetData()` wiped the shared blob
    /// on *any* signed-out render, including a launch that merely couldn't reach
    /// the server. Only an authoritative sign-out may clear it.
    @Test func testOnlyAuthoritativeSignOutClearsTheStoredSnapshot() {
        #expect(WidgetDataStore.shouldClearStoredSnapshot(on: .signedOut))
        #expect(WidgetDataStore.shouldClearStoredSnapshot(on: .unauthorized))
        #expect(!WidgetDataStore.shouldClearStoredSnapshot(on: .unreachable), "an offline cold start is not a sign-out")
        #expect(!WidgetDataStore.shouldClearStoredSnapshot(on: .serverError), "a 500 says nothing about the session")
    }

    /// The damage a wipe does, and why it looks like the row "reset": with no
    /// prior snapshot to carry forward, the network-free sync path has nothing to
    /// build a week from, so both the row and the streak start over.
    @Test func testWipedSnapshotLeavesTheRowBlankAndTheStreakAtZero() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil // the blob a failed launch had already cleared
        )
        #expect(snapshot.completedDates == [])
        #expect(snapshot.streak == 0)
        #expect(snapshot.weekMarks(now: now).filter(\.done).count == 0)
    }

    // MARK: - #671 symptom 2: the week must not reset at a calendar boundary

    /// Fixed `now` on a Monday with completions the preceding Wed–Sun: those days
    /// belong to the *previous* calendar week but are inside the trailing seven,
    /// so they must stay marked.
    @Test func testWeekBoundaryKeepsPriorCalendarWeekMarked() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        // 2026-03-16 is a Monday.
        let monday = ISO8601DateFormatter().date(from: "2026-03-16T12:00:00Z")!
        #expect(calendar.component(.weekday, from: monday) == 2, "fixture must be a Monday")

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
        #expect(done == Set(priorWeek), "prior-week completions must survive the boundary")
        #expect(marks.last?.iso == "2026-03-16")
        #expect(marks.last?.done == false, "Monday is still pending")
        #expect(
            WidgetDataStore.reconciledStreak(
                completedDates: priorWeek,
                serverStreak: nil,
                serverStreakDate: nil,
                now: monday,
                calendar: calendar
            ) == 5
        )
    }

    /// A snapshot written last week must still carry its history forward through
    /// the network-free sync path once the calendar week rolls over.
    @Test func testMakeSnapshotCarriesHistoryAcrossAWeekBoundary() {
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
        #expect(Set(snapshot.completedDates) == Set(priorDays))
        #expect(snapshot.streak == 5)
    }

    /// #671 AC6: a cold start with no network keeps the last known history —
    /// `normalizedForDisplay` is the widget's only read path, and it must never
    /// blank the row or zero an intact streak.
    @Test func testColdStartWithoutNetworkKeepsLastKnownHistory() {
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
        #expect(displayed.completedDates.count == 4)
        #expect(displayed.weekMarks(now: now).filter(\.done).count == 4)
        #expect(displayed.streak == 4)
    }
}
