import Foundation
import Testing
import StillPointShared

/// #663: the snapshot a `GET /api/sessions` refresh writes, shared by the
/// foreground backfill and the background refresh, and the history read that
/// stands in for the Home badge when the background refresh has none.
struct WidgetHistorySnapshotTests: WidgetDataTestSupport {
    // MARK: - makeHistorySnapshot

    /// The build moved out of `AppViewModel.refreshWidgetWeekHistory()` verbatim.
    /// Pins it to the `makeSnapshot` call that refresh used to make inline, so the
    /// foreground backfill writes exactly what it wrote before the move.
    @Test func testMatchesTheBuildTheForegroundBackfillMadeInline() {
        let now = Date()
        let user = makeUser(id: "u1")
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 30,
            secondTrackDay: 4,
            dualTrackEnabled: true,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 9,
            completedDates: [localDay(-3, from: now)],
            lastUpdated: now.addingTimeInterval(-3600)
        )
        let sessions = [
            session(date: localDay(0, from: now), type: .quick),
            session(date: localDay(-1, from: now), track: .second),
            session(date: localDay(-1, from: now), type: .breath),
            session(date: localDay(-2, from: now)),
            session(date: localDay(-2, from: now), completed: false, track: .second),
            session(date: localDay(-4, from: now), track: nil),
            session(date: localDay(-20, from: now)),
        ]

        let completed = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        let today = WidgetDataStore.localDayString(now)
        let inline = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: true,
            secondDoneToday: completed.second.contains(today),
            practiceDoneToday: completed.primary.contains(today),
            now: now,
            previous: previous,
            completedPracticeDates: completed.primary,
            secondCompletedPracticeDates: completed.second,
            completedStandardDates: WidgetDataStore.recentCompletedStandardDates(from: sessions, now: now),
            serverStreak: 11,
            serverStreakDate: WidgetDataStore.serverStreakAnchorDate(from: sessions)
        )

        let shared = WidgetDataStore.makeHistorySnapshot(
            user: user,
            primaryDoneToday: true,
            sessions: sessions,
            serverStreak: 11,
            now: now,
            previous: previous
        )

        #expect(shared == inline)
    }

    /// The `previous` it is given reaches `makeSnapshot`. The rows show an
    /// unbroken week and no server anchor falls inside it, so only the stored
    /// snapshot's carried streak can extend the count past the window. Dropping
    /// `previous` would leave the seven days the rows show.
    @Test func testForwardsThePreviousSnapshotItIsGiven() {
        let now = Date()
        let user = makeUser(id: "u1")
        let sessions = (0...6).map { offset in
            session(date: localDay(-offset, from: now), type: offset.isMultiple(of: 2) ? .quick : .breath)
        }
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 50,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            streak: 40,
            completedDates: (0...6).map { localDay(-$0, from: now) },
            lastUpdated: now.addingTimeInterval(-60)
        )

        let withPrevious = WidgetDataStore.makeHistorySnapshot(
            user: user,
            primaryDoneToday: false,
            sessions: sessions,
            serverStreak: 0,
            now: now,
            previous: previous
        )
        let withoutPrevious = WidgetDataStore.makeHistorySnapshot(
            user: user,
            primaryDoneToday: false,
            sessions: sessions,
            serverStreak: 0,
            now: now,
            previous: .loggedOut
        )

        #expect(withoutPrevious.streak == 7)
        #expect(withPrevious.streak > 7)
    }

    /// The #663 report: a sit done on the web reaches the widget once its
    /// history is refetched, whichever refresh fetched it.
    @Test func testAWebSitTodayChecksTodayAndExtendsTheStreak() {
        let now = Date()
        let user = makeUser(id: "u1")
        // What the phone last wrote: yesterday and the day before, today still open.
        let previous = WidgetDataStore.makeHistorySnapshot(
            user: user,
            primaryDoneToday: false,
            sessions: [
                session(date: localDay(-1, from: now)),
                session(date: localDay(-2, from: now)),
            ],
            serverStreak: 2,
            now: now,
            previous: .loggedOut
        )
        #expect(!previous.completedDates.contains(localDay(0, from: now)))
        #expect(previous.streak == 2)

        // Then a standard sit is saved from the web, and the server counts it.
        let sessions = [
            session(date: localDay(0, from: now)),
            session(date: localDay(-1, from: now)),
            session(date: localDay(-2, from: now)),
        ]
        let today = WidgetDataStore.localDayString(now)
        let snapshot = WidgetDataStore.makeHistorySnapshot(
            user: user,
            primaryDoneToday: WidgetDataStore.primaryStandardSitCompleted(on: today, in: sessions),
            sessions: sessions,
            serverStreak: 3,
            now: now,
            previous: previous
        )

        #expect(snapshot.completedDates.contains(today))
        #expect(snapshot.practiceDoneToday)
        #expect(snapshot.primaryDoneToday)
        #expect(snapshot.isDayKeptToday(at: now))
        #expect(snapshot.streak == 3)
        #expect(snapshot.serverStreakDate == today)
    }

    /// An uncontested history refresh replaces the rows outright: a day the
    /// stored snapshot carried but the server no longer has is dropped.
    @Test func testFetchedHistoryReplacesTheCarriedRows() {
        let now = Date()
        let previous = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 12,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 1,
            completedDates: [localDay(-3, from: now)],
            lastUpdated: now
        )

        let snapshot = WidgetDataStore.makeHistorySnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            sessions: [session(date: localDay(-1, from: now), type: .breath)],
            serverStreak: 0,
            now: now,
            previous: previous
        )

        #expect(snapshot.completedDates == [localDay(-1, from: now)])
        // A breath sit draws on the row but is not one the server streak counts.
        #expect(snapshot.standardDates == [])
        #expect(!snapshot.practiceDoneToday)
    }

    // MARK: - primaryStandardSitCompleted

    @Test func testACompletedPrimaryStandardSitOnTheDayCounts() {
        let day = "2026-10-26"
        #expect(
            WidgetDataStore.primaryStandardSitCompleted(
                on: day,
                in: [session(date: day)]
            )
        )
    }

    @Test func testASitWithNoTrackPredatesTheForkAndCountsAsPrimary() {
        let day = "2026-10-26"
        #expect(
            WidgetDataStore.primaryStandardSitCompleted(
                on: day,
                in: [session(date: day, track: nil)]
            )
        )
    }

    @Test func testOnlyAPrimaryStandardSitCounts() {
        let day = "2026-10-26"
        let notPrimaryStandard = [
            session(date: day, track: .second),
            session(date: day, type: .quick),
            session(date: day, type: .breath),
        ]
        #expect(!WidgetDataStore.primaryStandardSitCompleted(on: day, in: notPrimaryStandard))
    }

    @Test func testAnUnfinishedSitOrAnotherDayDoesNotCount() {
        let day = "2026-10-26"
        #expect(
            !WidgetDataStore.primaryStandardSitCompleted(
                on: day,
                in: [
                    session(date: day, completed: false),
                    session(date: "2026-10-25"),
                ]
            )
        )
        #expect(!WidgetDataStore.primaryStandardSitCompleted(on: day, in: []))
    }

    // MARK: - practiceInstant (the 6:00 grace window, #767)

    /// A fixed zone, so the hour checks do not depend on where the tests run.
    private var newYork: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func october(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        newYork.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    private func practiceDay(_ sessions: [SessionDTO], dualTrack: Bool = false, at now: Date) -> String {
        let instant = WidgetDataStore.practiceInstant(
            forHistory: sessions,
            dualTrackEnabled: dualTrack,
            now: now,
            calendar: newYork
        )
        return WidgetDataStore.localDayString(instant, calendar: newYork)
    }

    /// A background run at 2:30 after a day with no sit builds the snapshot as
    /// of that day, so the widget keeps showing it as today until 6:00.
    @Test func testBefore6AnUnfinishedPreviousDayIsStillThePracticeDay() {
        let now = october(27, 2, 30)
        let sessions = [session(date: "2026-10-25")]
        let instant = WidgetDataStore.practiceInstant(
            forHistory: sessions,
            dualTrackEnabled: false,
            now: now,
            calendar: newYork
        )

        #expect(WidgetDataStore.localDayString(instant, calendar: newYork) == "2026-10-26")
        #expect(
            WidgetDataStore.graceKeepsPreviousPracticeDay(
                lastUpdated: instant,
                now: now,
                requiredSitsComplete: false,
                calendar: newYork
            )
        )
    }

    @Test func testBefore6AFinishedPreviousDayRollsToTheCalendarDay() {
        let now = october(27, 2, 30)
        let sessions = [session(date: "2026-10-26")]
        #expect(WidgetDataStore.practiceInstant(forHistory: sessions, dualTrackEnabled: false, now: now, calendar: newYork) == now)
    }

    /// Only a completed standard sit finishes a day, as `/api/track/done-today`
    /// counts it.
    @Test func testAQuickOrUnfinishedSitLeavesThePreviousDayOpen() {
        let now = october(27, 2, 30)
        let sessions = [
            session(date: "2026-10-26", type: .quick),
            session(date: "2026-10-26", completed: false),
        ]
        #expect(practiceDay(sessions, at: now) == "2026-10-26")
    }

    @Test func testTwoADayNeedsBothSitsToFinishThePreviousDay() {
        let now = october(27, 2, 30)
        let primaryOnly = [session(date: "2026-10-26")]
        #expect(practiceDay(primaryOnly, dualTrack: true, at: now) == "2026-10-26")

        let both = primaryOnly + [session(date: "2026-10-26", track: .second)]
        #expect(practiceDay(both, dualTrack: true, at: now) == "2026-10-27")
    }

    @Test func testAt6TheCalendarDayStartsEitherWay() {
        let now = october(27, 6, 0)
        #expect(WidgetDataStore.practiceInstant(forHistory: [], dualTrackEnabled: false, now: now, calendar: newYork) == now)
    }

    /// The CodeAnt case on PR #908: on a two-a-day schedule at 2:30, the primary
    /// sit credited to the still-open previous day reads as done today, as the
    /// foreground's Home badge reports it.
    @Test func testThePrimarySitOfAnOpenPracticeDayReadsAsDoneToday() {
        let now = october(27, 2, 30)
        let sessions = [session(date: "2026-10-26")]
        let day = practiceDay(sessions, dualTrack: true, at: now)

        #expect(WidgetDataStore.primaryStandardSitCompleted(on: day, in: sessions))
        #expect(
            !WidgetDataStore.primaryStandardSitCompleted(
                on: WidgetDataStore.localDayString(now, calendar: newYork),
                in: sessions
            )
        )
    }

    // MARK: - practiceInstant(previousDayComplete:) — the foreground's instant (#918)

    /// The instant the foreground's history refresh stamps when its fetch lands:
    /// `creditedPracticeInstant(now:)`, which applies this rule to the app's own
    /// answer for whether the previous day is finished, as `syncWidgetData()` does.
    private func foregroundInstant(previousDayComplete: Bool, at now: Date) -> Date {
        WidgetDataStore.practiceInstant(previousDayComplete: previousDayComplete, now: now, calendar: newYork)
    }

    /// From midnight to 5:59, after a day whose sits are unfinished, the
    /// foreground stamps that day, so the widget keeps it as today until 6:00.
    @Test func testBefore6TheForegroundStampsTheUnfinishedPreviousDay() {
        for now in [october(27, 0, 0), october(27, 2, 30), october(27, 5, 59)] {
            let instant = foregroundInstant(previousDayComplete: false, at: now)

            #expect(instant == october(26, 23))
            #expect(
                WidgetDataStore.graceKeepsPreviousPracticeDay(
                    lastUpdated: instant,
                    now: now,
                    requiredSitsComplete: false,
                    calendar: newYork
                )
            )
        }
    }

    @Test func testBefore6AFinishedPreviousDayLeavesTheForegroundOnTheClock() {
        let now = october(27, 2, 30)
        #expect(foregroundInstant(previousDayComplete: true, at: now) == now)
    }

    @Test func testFrom6TheForegroundStampsTheClockEitherWay() {
        for now in [october(27, 6, 0), october(27, 13, 0), october(27, 23, 59)] {
            #expect(foregroundInstant(previousDayComplete: false, at: now) == now)
            #expect(foregroundInstant(previousDayComplete: true, at: now) == now)
        }
    }

    // MARK: - The foreground's history snapshot in the grace window (#918)

    /// `makeHistorySnapshot` and the widget's display read the device's time
    /// zone, so these fixtures are built in it, in July, clear of DST changes.
    private func july(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = Calendar.current.timeZone
        return calendar.date(from: DateComponents(year: 2026, month: 7, day: day, hour: hour, minute: minute))!
    }

    /// What the foreground fetches at 2:30 on July 15: July 12 and 13 kept, and
    /// nothing yet on July 14, the day the grace window holds open.
    private func graceHistorySnapshot(stampedAt instant: Date) -> WidgetData {
        WidgetDataStore.makeHistorySnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            sessions: [session(date: "2026-07-12"), session(date: "2026-07-13")],
            serverStreak: 2,
            now: instant,
            previous: .loggedOut
        )
    }

    /// The #918 report. Stamped on the open practice day, the snapshot keeps that
    /// day on the widget as today, still pending, with the streak standing. The
    /// clock time the foreground stamped before rolled the widget onto the
    /// calendar day early: the open day read as missed and the streak as 0.
    @Test func testTheForegroundHistorySnapshotKeepsTheOpenDayAndItsStreak() {
        let now = july(15, 2, 30)
        let snapshot = graceHistorySnapshot(
            stampedAt: WidgetDataStore.practiceInstant(previousDayComplete: false, now: now)
        )

        #expect(WidgetDataStore.localDayString(snapshot.lastUpdated) == "2026-07-14")
        let shown = WidgetDataStore.normalizedForDisplay(snapshot, now: now)
        #expect(shown.streak == 2)
        let today = shown.weekMarks(now: now).last
        #expect(today?.iso == "2026-07-14")
        #expect(today?.done == false)

        let clockStamped = WidgetDataStore.normalizedForDisplay(graceHistorySnapshot(stampedAt: now), now: now)
        #expect(clockStamped.streak == 0)
        let missed = clockStamped.weekMarks(now: now).dropLast().last
        #expect(missed?.iso == "2026-07-14")
        #expect(missed?.done == false)
    }

    /// The refresher hands `save` the same instant, so a history snapshot that
    /// lands after another write merges onto it and still keeps the open day.
    @Test func testAMergedForegroundHistorySnapshotKeepsTheOpenDay() throws {
        let now = july(15, 2, 30)
        let instant = WidgetDataStore.practiceInstant(previousDayComplete: false, now: now)
        // What `syncWidgetData()` stored while the fetch was in flight.
        let (seeded, _) = WidgetDataStore.resolveWrite(
            incoming: WidgetDataStore.makeSnapshot(
                user: makeUser(id: "u1"),
                primaryDoneToday: false,
                secondDoneToday: false,
                practiceDoneToday: false,
                now: instant,
                flagsAsOf: instant,
                previous: .loggedOut
            ),
            observedGeneration: 0,
            stored: nil,
            now: instant
        )
        let stored = try #require(seeded)

        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: graceHistorySnapshot(stampedAt: instant),
            observedGeneration: 0,
            stored: stored,
            now: instant
        )

        #expect(outcome == .merged)
        let merged = try #require(resolved)
        #expect(WidgetDataStore.localDayString(merged.lastUpdated) == "2026-07-14")
        #expect(WidgetDataStore.normalizedForDisplay(merged, now: now).streak == 2)
    }
}
