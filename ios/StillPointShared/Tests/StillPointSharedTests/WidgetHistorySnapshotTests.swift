import XCTest
import StillPointShared

/// #663: the snapshot a `GET /api/sessions` refresh writes, shared by the
/// foreground backfill and the background refresh, and the history read that
/// stands in for the Home badge when the background refresh has none.
final class WidgetHistorySnapshotTests: XCTestCase, WidgetDataTestSupport {
    // MARK: - makeHistorySnapshot

    /// The build moved out of `AppViewModel.refreshWidgetWeekHistory()` verbatim.
    /// Pins it to the `makeSnapshot` call that refresh used to make inline, so the
    /// foreground backfill writes exactly what it wrote before the move.
    func testMatchesTheBuildTheForegroundBackfillMadeInline() {
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

        XCTAssertEqual(shared, inline)
    }

    /// The `previous` it is given reaches `makeSnapshot`. The rows show an
    /// unbroken week and no server anchor falls inside it, so only the stored
    /// snapshot's carried streak can extend the count past the window. Dropping
    /// `previous` would leave the seven days the rows show.
    func testForwardsThePreviousSnapshotItIsGiven() {
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

        XCTAssertEqual(withoutPrevious.streak, 7)
        XCTAssertGreaterThan(withPrevious.streak, 7)
    }

    /// The #663 report: a sit done on the web reaches the widget once its
    /// history is refetched, whichever refresh fetched it.
    func testAWebSitTodayChecksTodayAndExtendsTheStreak() {
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
        XCTAssertFalse(previous.completedDates.contains(localDay(0, from: now)))
        XCTAssertEqual(previous.streak, 2)

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

        XCTAssertTrue(snapshot.completedDates.contains(today))
        XCTAssertTrue(snapshot.practiceDoneToday)
        XCTAssertTrue(snapshot.primaryDoneToday)
        XCTAssertTrue(snapshot.isDayKeptToday(at: now))
        XCTAssertEqual(snapshot.streak, 3)
        XCTAssertEqual(snapshot.serverStreakDate, today)
    }

    /// An uncontested history refresh replaces the rows outright: a day the
    /// stored snapshot carried but the server no longer has is dropped.
    func testFetchedHistoryReplacesTheCarriedRows() {
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

        XCTAssertEqual(snapshot.completedDates, [localDay(-1, from: now)])
        // A breath sit draws on the row but is not one the server streak counts.
        XCTAssertEqual(snapshot.standardDates, [])
        XCTAssertFalse(snapshot.practiceDoneToday)
    }

    // MARK: - primaryStandardSitCompleted

    func testACompletedPrimaryStandardSitOnTheDayCounts() {
        let day = "2026-10-26"
        XCTAssertTrue(WidgetDataStore.primaryStandardSitCompleted(
            on: day,
            in: [session(date: day)]
        ))
    }

    func testASitWithNoTrackPredatesTheForkAndCountsAsPrimary() {
        let day = "2026-10-26"
        XCTAssertTrue(WidgetDataStore.primaryStandardSitCompleted(
            on: day,
            in: [session(date: day, track: nil)]
        ))
    }

    func testOnlyAPrimaryStandardSitCounts() {
        let day = "2026-10-26"
        let notPrimaryStandard = [
            session(date: day, track: .second),
            session(date: day, type: .quick),
            session(date: day, type: .breath),
        ]
        XCTAssertFalse(WidgetDataStore.primaryStandardSitCompleted(on: day, in: notPrimaryStandard))
    }

    func testAnUnfinishedSitOrAnotherDayDoesNotCount() {
        let day = "2026-10-26"
        XCTAssertFalse(WidgetDataStore.primaryStandardSitCompleted(
            on: day,
            in: [
                session(date: day, completed: false),
                session(date: "2026-10-25"),
            ]
        ))
        XCTAssertFalse(WidgetDataStore.primaryStandardSitCompleted(on: day, in: []))
    }
}
