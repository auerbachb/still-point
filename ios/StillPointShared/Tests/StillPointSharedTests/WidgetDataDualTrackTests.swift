import Foundation
import Testing
import StillPointShared

struct WidgetDataDualTrackTests: WidgetDataTestSupport {
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
    @Test func testStreakNeverContradictsTheRenderedRow() {
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
            #expect(unionRow == rowOne.union(rowTwo), "union row is not what the rows show (mask=\(mask))")
            #expect(unionRow == keptDays, "the rendered rows lost a kept day (mask=\(mask))")
            #expect(rowOne.isSubset(of: Set(primaryDates)), "Track One marked a day it did not sit (mask=\(mask))")
            #expect(rowTwo.isSubset(of: Set(secondDates)), "Track Two marked a day it did not sit (mask=\(mask))")

            for (serverStreak, serverStreakDate) in serverCases {
                let shown = snapshot(serverStreak: serverStreak, serverStreakDate: serverStreakDate)
                let context = "mask=\(mask) server=\(String(describing: serverStreak))"
                let rowRun = shown.weekRowStreak(now: now)
                // Rows with no run mean no streak — nothing may inflate it.
                if rowRun == 0 {
                    #expect(shown.streak == 0, "streak must be 0 when the rows show none (\(context))")
                    continue
                }
                // The streak may never undercount days the rows visibly show.
                #expect(shown.streak >= rowRun, "streak below the rows (\(context))")
                // When the rows can see where the run began, the streak must match
                // exactly — only a run that leaves the window may exceed it.
                if !shown.weekRowStreakReachesWindowEdge(now: now) {
                    #expect(shown.streak == rowRun, "streak exceeds a visibly broken row (\(context))")
                }
            }
        }
    }

    @Test func testWeekRowStreakReadsTheRenderedMarks() {
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
        #expect(data.weekRowStreak(now: now) == 2)
        #expect(!data.weekRowStreakReachesWindowEdge(now: now))
    }

    @Test func testWeekMarksPopulateWeekdayName() {
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
        #expect(!(data.weekMarks(now: now).last?.weekdayName.isEmpty ?? true))
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

    @Test func testCodableRoundTripPreservesBothTrackHistories() throws {
        let original = dualTrackData(
            now: Date(timeIntervalSince1970: 1_700_000_000),
            completedDates: ["2026-08-20"],
            secondCompletedDates: ["2026-08-21"]
        )
        let decoded = try JSONDecoder().decode(WidgetData.self, from: JSONEncoder().encode(original))
        #expect(decoded == original)
        #expect(decoded.secondCompletedDates == ["2026-08-21"])
    }

    /// Snapshots written before the two-a-day rows shipped keep their history on
    /// Track One and start Track Two empty — no back-fill, no crash.
    @Test func testDecodesPreDualTrackBlobIntoTrackOneOnly() throws {
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
        #expect(decoded.completedDates == ["2026-08-19", "2026-08-20"])
        #expect(decoded.secondCompletedDates == [])
        #expect(decoded.streak == 7)
    }

    @Test func testSessionCountsForWidgetPracticeIsTrackAware() {
        let day = "2026-08-20"
        let primaryStandard = session(date: day, type: .standard, track: .primary)
        let secondStandard = session(date: day, type: .standard, track: .second)
        let quickOnSecond = session(date: day, type: .quick, track: .second)
        let untracked = session(date: day, type: .standard, track: nil)
        let incompleteSecond = session(date: day, type: .standard, completed: false, track: .second)

        #expect(WidgetDataStore.sessionCountsForWidgetPractice(primaryStandard, track: .primary))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(primaryStandard, track: .second))
        #expect(WidgetDataStore.sessionCountsForWidgetPractice(secondStandard, track: .second))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(secondStandard, track: .primary))
        // Quick and breath sits are Track One practice whatever track they carry.
        #expect(WidgetDataStore.sessionCountsForWidgetPractice(quickOnSecond, track: .primary))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(quickOnSecond, track: .second))
        // A session predating the dual-track fork is treated as primary.
        #expect(WidgetDataStore.sessionCountsForWidgetPractice(untracked, track: .primary))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(untracked, track: .second))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(incompleteSecond, track: .second))
        // The no-track overload keeps its pre-#684 Track One meaning.
        #expect(WidgetDataStore.sessionCountsForWidgetPractice(primaryStandard))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(secondStandard))
    }

    /// #839: a focus session is not meditation practice, so a completed one checks
    /// neither row, whatever track it carries.
    @Test func testCompletedFocusSessionCountsForNeitherWidgetRow() {
        let tracks: [Track?] = [.primary, .second, nil]
        for track in tracks {
            let focus = session(date: "2026-10-27", type: .focus, track: track)
            let label = track?.rawValue ?? "nil"
            #expect(!WidgetDataStore.sessionCountsForWidgetPractice(focus, track: .primary), Comment(rawValue: label))
            #expect(!WidgetDataStore.sessionCountsForWidgetPractice(focus, track: .second), Comment(rawValue: label))
            #expect(!WidgetDataStore.sessionCountsForWidgetPractice(focus), Comment(rawValue: label))
        }
    }

    @Test func testRecentCompletedPracticeDatesLeavesOutFocusSessions() {
        let now = Date()
        let today = localDay(0, from: now)
        let oneDayAgo = localDay(-1, from: now)

        let sessions = [
            session(date: today, type: .focus, track: .primary),
            session(date: oneDayAgo, type: .standard, track: .primary),
            session(date: oneDayAgo, type: .focus, track: .second)
        ]

        let result = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        #expect(result.primary == [oneDayAgo])
        #expect(result.second.isEmpty)
    }

    @Test func testRecentCompletedPracticeDatesSplitsTracksOverSameWindow() {
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
        #expect(result.primary == [today, oneDayAgo])
        #expect(result.second == [today, oneDayAgo])
        #expect(!result.second.contains(tenDaysAgo))
    }

    /// Completing one of the two sits checks that row for today — and only that
    /// row — without waiting for the other session.
    @Test func testMakeSnapshotFoldsTodayIntoTheCompletedTrackOnly() {
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
        #expect(secondOnly.secondCompletedDates == [today])
        #expect(secondOnly.completedDates == [])

        let bothTracks = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: true,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        #expect(bothTracks.completedDates == [today])
        #expect(bothTracks.secondCompletedDates == [today])
    }

    @Test func testMakeSnapshotCarriesForwardBothTrackHistories() {
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
        #expect(snapshot.completedDates == [twoDaysAgo])
        #expect(snapshot.secondCompletedDates == [threeDaysAgo])
    }

    @Test func testMakeSnapshotReplacesSecondTrackHistoryAuthoritatively() {
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
        #expect(snapshot.secondCompletedDates == [threeDaysAgo])
    }

    @Test func testMakeSnapshotDropsBothTrackHistoriesOnAccountSwitch() {
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
        #expect(snapshot.completedDates == [])
        #expect(snapshot.secondCompletedDates == [])
    }

    @Test func testNormalizedForDisplayPrunesBothTrackHistories() {
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
        #expect(normalized.completedDates == [inWindow])
        #expect(normalized.secondCompletedDates == [inWindow])
        #expect(!normalized.secondDoneToday)
    }

    // MARK: - #684 day-credit rule: at least one session keeps the day

    /// Finishing only the shorter (second) sit keeps the streak moving.
    ///
    /// #671 note: the previous snapshot carries the four days the run is built
    /// from. A carried number with no history behind it is exactly what this PR
    /// stops the widget displaying, so the fixture supplies the evidence the row
    /// would be drawing.
    @Test func testStreakKeptWhenOnlySecondSessionCompleted() {
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
        #expect(snapshot.streak == 5)
        #expect(snapshot.secondCompletedDates.contains(localDay(0, from: now)))
        #expect(!snapshot.completedDates.contains(localDay(0, from: now)))
    }

    /// Continuity walks the union of both tracks: no day here has zero sits, so
    /// alternating between the two sessions still builds one streak.
    @Test func testStreakWalksUnionOfBothTracks() {
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
        #expect(snapshot.streak == 4)
    }

    /// A day with zero sits still breaks continuity.
    @Test func testStreakBreaksOnDayWithNoSitOnEitherTrack() {
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
        #expect(snapshot.streak == 0)
    }

    /// Regression: the old carry-forward preserved a streak no matter how long
    /// the app had been closed. Two or more sit-free days must reset it.
    @Test func testStreakResetsAfterMultiDayGap() {
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
        #expect(snapshot.streak == 0)
    }

    /// The 7-day window is a lower bound, not a cap: a longer streak carried in
    /// the previous snapshot survives an unbroken week of history.
    @Test func testStreakLongerThanWindowSurvives() {
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
        #expect(snapshot.streak == 30)
    }

    /// …and it keeps counting: a sit today on a week the rows show unbroken
    /// advances the carried total rather than collapsing to the window length.
    @Test func testCarriedStreakLongerThanWindowIncrementsAcrossADay() {
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
        #expect(snapshot.streak == 31)
    }

    /// #671 × #684: the carried total is a *candidate*, never an override. When
    /// the rows show where the run actually broke, the number beside them is the
    /// run they draw — no matter what the previous snapshot claimed.
    @Test func testCarriedStreakIsIgnoredWhenTheRowsShowABreak() {
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
        #expect(snapshot.streak == 2)
        #expect(snapshot.weekRowStreak(now: now) == 2)
    }

    @Test func testIsDayKeptTodayHonorsEitherTrack() {
        let now = Date()
        #expect(dualTrackData(now: now, secondDoneToday: true).isDayKeptToday(at: now))
        #expect(dualTrackData(now: now, practiceDoneToday: true).isDayKeptToday(at: now))
        #expect(!dualTrackData(now: now).isDayKeptToday(at: now))
    }

    // MARK: - #684 carry-forward, bounded by the #671 row invariant

    /// Every case below feeds `resolvedStreak` the history the rows would be
    /// drawing, because the carried value is only admissible while the rows
    /// corroborate an unbroken run back to the oldest column. With no history at
    /// all the rows are blank, and a blank row may never carry a streak.

    @Test func testResolvedStreakIncrementsWhenPracticeDoneFlips() {
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
        #expect(streak == 31)
    }

    @Test func testResolvedStreakResetsOnAccountSwitch() {
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
        #expect(streak == 0)
    }

    @Test func testResolvedStreakResetsOnNewLocalDayWithoutCompletion() {
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
        #expect(streak == 0)
    }

    @Test func testResolvedStreakPreservesOnNewDayAfterYesterdayComplete() {
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
        #expect(streak == 20)
    }

    @Test func testResolvedStreakIncrementsOnNewDayWhenAlreadyDone() {
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
        #expect(streak == 21)
    }

    // MARK: - #684 per-track weekday rows

    @Test func testWeekMarksPerTrackReflectOnlyTheirOwnCompletions() {
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
        #expect(trackOne.count == 7)
        #expect(trackTwo.count == 7)
        #expect(trackOne.first(where: { $0.iso == oneDayAgo })?.done == true)
        #expect(trackOne.first(where: { $0.iso == twoDaysAgo })?.done == false)
        #expect(trackTwo.first(where: { $0.iso == twoDaysAgo })?.done == true)
        #expect(trackTwo.first(where: { $0.iso == oneDayAgo })?.done == false)

        // The single-row layout keeps showing a day kept by either track.
        let union = data.weekMarks(now: now)
        #expect(union.first(where: { $0.iso == oneDayAgo })?.done == true)
        #expect(union.first(where: { $0.iso == twoDaysAgo })?.done == true)
    }

    @Test func testWeekMarksPerTrackUseTheirOwnDoneTodayFallback() {
        let now = Date()
        let data = dualTrackData(now: now, secondDoneToday: true)
        #expect(data.weekMarks(for: .primary, now: now).last?.done == false)
        #expect(data.weekMarks(for: .second, now: now).last?.done == true)
        #expect(data.weekMarks(now: now).last?.done == true)
    }

    /// Days practised before the switch to two-a-day render on Track One only.
    @Test func testPreSwitchHistoryRendersOnTrackOneOnly() {
        let now = Date()
        let preSwitch = [localDay(-5, from: now), localDay(-4, from: now)]
        let data = dualTrackData(
            now: now,
            completedDates: preSwitch,
            secondCompletedDates: [localDay(-1, from: now)]
        )
        let trackTwo = data.weekMarks(for: .second, now: now)
        for iso in preSwitch {
            #expect(trackTwo.first(where: { $0.iso == iso })?.done == false)
        }
        let trackOne = data.weekMarks(for: .primary, now: now)
        for iso in preSwitch {
            #expect(trackOne.first(where: { $0.iso == iso })?.done == true)
        }
    }

    /// A single-session setup has no Track Two history, so its row is unchanged.
    @Test func testSingleTrackSetupRendersOneUnchangedRow() {
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
        #expect(data.secondCompletedDates == [])
        #expect(data.weekMarks(now: now) == data.weekMarks(for: .primary, now: now))
        #expect(data.weekMarks(now: now).first(where: { $0.iso == oneDayAgo })?.done == true)
    }
}

// MARK: - #896 combined sit

extension WidgetDataDualTrackTests {
    private func combinedSession(date: String, completed: Bool = true) -> SessionDTO {
        SessionDTO(
            id: "\(date)-combined-\(completed)", dayNumber: 30, duration: 1200, completed: completed,
            actualTime: 1200, clearPercent: 0, thoughtCount: 0, mindStateLog: nil, sessionDate: date,
            buddySessionId: nil, track: .primary, combined: true
        )
    }

    /// A completed standard combined sit marks both tracks' rows (whichever of AM
    /// and PM each row is drawn as, via `longSessionPeriod`).
    @Test func testCompletedCombinedSitMarksBothRows() {
        let now = Date()
        let today = localDay(0, from: now)
        let sit = combinedSession(date: today)

        #expect(WidgetDataStore.sessionCountsForWidgetPractice(sit, track: .primary))
        #expect(WidgetDataStore.sessionCountsForWidgetPractice(sit, track: .second))
        let dates = WidgetDataStore.recentCompletedPracticeDates(from: [sit], now: now)
        #expect(dates.primary == [today])
        #expect(dates.second == [today])

        for period in [SessionPeriod.am, .pm] {
            let data = WidgetData(
                isLoggedIn: true, userId: "u1", currentDay: 30, secondTrackDay: 4,
                dualTrackEnabled: true, longSessionPeriod: period,
                primaryDoneToday: true, secondDoneToday: true, practiceDoneToday: true,
                streak: 1, completedDates: Array(dates.primary), secondCompletedDates: Array(dates.second),
                lastUpdated: now
            )
            #expect(data.weekMarks(for: .primary, now: now).first(where: { $0.iso == today })?.done == true)
            #expect(data.weekMarks(for: .second, now: now).first(where: { $0.iso == today })?.done == true)
        }
    }

    @Test func testEndedEarlyCombinedSitMarksNeitherRow() {
        let now = Date()
        let sit = combinedSession(date: localDay(0, from: now), completed: false)
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(sit, track: .primary))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(sit, track: .second))
        let dates = WidgetDataStore.recentCompletedPracticeDates(from: [sit], now: now)
        #expect(dates.primary.isEmpty)
        #expect(dates.second.isEmpty)
    }

    /// The server-streak policy is unchanged: a combined sit is one standard sit.
    @Test func testCombinedSitIsOneStandardSitForTheServerStreak() {
        let now = Date()
        let today = localDay(0, from: now)
        let sit = combinedSession(date: today)
        #expect(WidgetDataStore.sessionCountsForServerStreak(sit))
        #expect(WidgetDataStore.recentCompletedStandardDates(from: [sit], now: now) == [today])
        #expect(WidgetDataStore.serverStreakAnchorDate(from: [sit]) == today)
        #expect(!WidgetDataStore.sessionCountsForServerStreak(combinedSession(date: today, completed: false)))
    }
}
