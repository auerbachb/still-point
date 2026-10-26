import XCTest
import StillPointShared

final class WidgetDataServerStreakAnchorTests: XCTestCase, WidgetDataTestSupport {
    // MARK: - #679: only the days that produced the server total may extend it

    /// The snapshot the authoritative backfill writes for `sessions`, derived
    /// through exactly the helpers `AppViewModel.refreshWidgetWeekHistory()`
    /// calls. Driving the tests through the whole chain (rows, standard set,
    /// anchor) means a policy drift in any one of them fails here, not just a
    /// drift in the arithmetic.
    ///
    /// `anchoredOn` overrides the derived anchor to model a *stale* pair: the
    /// (streak, day) a fetch returned earlier, carried forward while later days
    /// accumulated locally.
    private func backfilled(
        sessions: [SessionDTO],
        serverStreak: Int,
        anchoredOn: String? = nil,
        now: Date,
        user: UserDTO? = nil
    ) -> WidgetData {
        let completed = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        return WidgetDataStore.makeSnapshot(
            user: user ?? makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: completed.primary,
            secondCompletedPracticeDates: completed.second,
            completedStandardDates: WidgetDataStore.recentCompletedStandardDates(from: sessions, now: now),
            serverStreak: serverStreak,
            serverStreakDate: anchoredOn ?? WidgetDataStore.serverStreakAnchorDate(from: sessions)
        )
    }

    /// Primary standard sits on the given day offsets, so a case only has to
    /// spell out the days that make it interesting.
    private func standardRun(_ offsets: [Int], from now: Date) -> [SessionDTO] {
        offsets.map { session(date: localDay($0, from: now), type: .standard, track: .primary) }
    }

    /// The ticket's worked example. Five standard days, then two quick-only days:
    /// the row runs the full seven and reaches the window edge, so the server
    /// total is allowed to extend it — but the two quick days contributed nothing
    /// to that total, so they may add nothing. Before the fix this read
    /// `10 + 2 = 12` against the app and web's 10.
    func testQuickOnlyDaysAfterTheAnchorDoNotExtendTheServerTotal() {
        let now = Date()
        let sessions = standardRun([-6, -5, -4, -3, -2], from: now) + [
            session(date: localDay(-1, from: now), type: .quick),
            session(date: localDay(0, from: now), type: .quick)
        ]
        let snapshot = backfilled(sessions: sessions, serverStreak: 10, now: now)

        XCTAssertEqual(
            snapshot.serverStreakDate,
            localDay(-2, from: now),
            "precondition: anchored on the most recent standard sit"
        )
        XCTAssertEqual(snapshot.weekRowStreak(now: now), 7, "precondition: the row reaches the window edge")
        XCTAssertEqual(snapshot.streak, 10, "the widget must show the number the app and web show")
        XCTAssertNotEqual(snapshot.streak, 12, "practice days may not extend a standard-only total")
    }

    /// The common single-day version of the same bug: standard yesterday, quick
    /// today. Previously 11 against the app's 10.
    func testQuickSitTodayDoesNotPushThePastTheAppStreak() {
        let now = Date()
        let sessions = standardRun([-6, -5, -4, -3, -2, -1], from: now)
            + [session(date: localDay(0, from: now), type: .quick)]
        let snapshot = backfilled(sessions: sessions, serverStreak: 10, now: now)

        XCTAssertEqual(snapshot.weekRowStreak(now: now), 7, "precondition: the row reaches the window edge")
        XCTAssertEqual(snapshot.streak, 10)
        XCTAssertNotEqual(snapshot.streak, 11, "a quick sit is not a standard sit")
    }

    /// The benefit the anchor exists for must survive: a standard sit *today*
    /// still extends a streak older than the seven-day row, with no second fetch.
    /// The fast, network-free path folds today in from the per-track standard
    /// flags, which is why `primaryDoneToday` is the discriminator below.
    ///
    /// This shape is the *refreshed* one — the server badge has caught up. The
    /// moment right after the sit, when it has not, is
    /// `testStandardSitTodayExtendsBeforeTheServerBadgeCatchesUp`.
    func testStandardSitTodayStillExtendsAStreakOlderThanTheRow() {
        let now = Date()
        let previous = backfilled(
            sessions: standardRun([-6, -5, -4, -3, -2, -1], from: now),
            serverStreak: 30,
            now: now
        )
        XCTAssertEqual(previous.streak, 30, "precondition: the carried total is older than the row")

        let afterStandardSit = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertEqual(afterStandardSit.streak, 31, "a standard sit today extends the carried server total")

        // Control: the same sit shape, but a quick one. The row still checks
        // today (it is practice), yet the standard-only total may not move.
        let afterQuickSit = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertTrue(afterQuickSit.isTodayMarkedDone(now: now), "the row still checks today")
        XCTAssertEqual(afterQuickSit.streak, 30, "but a quick sit adds nothing to a standard-only total")
    }

    /// The real completion path, which the test above cannot reach because it sets
    /// the server badge by hand.
    ///
    /// `markPracticeDoneToday` runs the instant a sit finishes: it raises the local
    /// flags and calls `syncWidgetData()` immediately, while `primaryDoneToday` —
    /// the Home badge, filled in by `getTracksDoneToday` — is still false. Folding
    /// today into the standard-only set on the badge alone therefore withheld the
    /// extension until the next round-trip, so the flame did not move when the user
    /// finished their sit. `primaryStandardDoneToday` is the local, standard-only
    /// Track One signal that closes that gap, exactly as `secondPracticeDoneToday`
    /// already does for Track Two (#684).
    func testStandardSitTodayExtendsBeforeTheServerBadgeCatchesUp() {
        let now = Date()
        let previous = backfilled(
            sessions: standardRun([-6, -5, -4, -3, -2, -1], from: now),
            serverStreak: 30,
            now: now
        )

        // Exactly what `syncWidgetData()` passes in the moment after a primary
        // standard sit: local flags up, server badge not yet refreshed.
        let justFinished = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            primaryStandardDoneToday: true,
            now: now,
            previous: previous
        )
        XCTAssertEqual(
            justFinished.streak,
            31,
            "the flame must move on the sit, not on the round-trip that confirms it"
        )
        XCTAssertTrue(justFinished.standardDates.contains(localDay(0, from: now)))

        // The discriminator is still the session *type*, not merely locality: a
        // quick sit raises `practiceDoneToday` through the same call and must not
        // move the standard-only total.
        let afterQuickSit = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            primaryStandardDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(afterQuickSit.streak, 30, "a quick sit is still not a standard sit")
        XCTAssertFalse(afterQuickSit.standardDates.contains(localDay(0, from: now)))
    }

    /// The second-track half of the same moment: `syncWidgetData()` already passes
    /// the local `secondPracticeDoneToday` as `secondDoneToday` (#684), so a
    /// just-finished second-track standard sit extends without a round-trip too.
    func testSecondTrackStandardSitTodayExtendsWithoutTheServerBadge() {
        let now = Date()
        let previous = backfilled(
            sessions: standardRun([-6, -5, -4, -3, -2, -1], from: now),
            serverStreak: 30,
            now: now
        )
        let justFinished = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: true,
            practiceDoneToday: false,
            primaryStandardDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(justFinished.streak, 31)
        XCTAssertTrue(justFinished.standardDates.contains(localDay(0, from: now)))
    }

    /// The midnight case for the signal the two tests above introduce.
    ///
    /// `primaryStandardDoneToday` is a claim about one local day, but the path that
    /// carries it is deliberately network-free — `markPracticeDoneToday` ->
    /// `syncWidgetData()` — while the only clear used to live behind a network
    /// round-trip (`refreshTracksDoneToday()`). So an app held open across midnight
    /// could reach this function with yesterday's flag still raised, and a *quick*
    /// sit at 00:05 would fold today into the standard-only set: a day with no
    /// standard sit joining the population that extends `serverStreak`, which is
    /// precisely the inflation #679 exists to remove.
    ///
    /// `flagsAsOf` is the day the flags describe; when it is not today's, they are
    /// retired before any of them is read. The two calls differ in that argument
    /// alone, so the assertion isolates staleness and nothing else.
    func testStaleDoneTodayFlagsDoNotExtendTheStandardTotalAfterMidnight() {
        let now = Date()
        let yesterday = now.addingTimeInterval(-36 * 3600)
        let previous = backfilled(
            sessions: standardRun([-6, -5, -4, -3, -2, -1], from: now),
            serverStreak: 30,
            now: now
        )

        // Control: the identical call with flags stamped today still extends.
        let fresh = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            primaryStandardDoneToday: true,
            now: now,
            flagsAsOf: now,
            previous: previous
        )
        XCTAssertEqual(fresh.streak, 31, "precondition: a same-day flag still extends")
        XCTAssertTrue(fresh.standardDates.contains(localDay(0, from: now)))

        let stale = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            primaryStandardDoneToday: true,
            now: now,
            flagsAsOf: yesterday,
            previous: previous
        )
        XCTAssertFalse(
            stale.standardDates.contains(localDay(0, from: now)),
            "yesterday's standard flag must not enter today's standard-only set"
        )
        XCTAssertEqual(
            stale.streak,
            30,
            "the server total may not gain a day that carried no standard sit"
        )
    }

    /// The same retirement applied to the other two terms of the standard-set
    /// disjunction. `primaryDoneToday` and `secondDoneToday` are server-derived
    /// badges rather than local flags, but they are read on the same network-free
    /// path and go stale across midnight identically — so fixing only the local
    /// flag would have left the very same inflation reachable through either of
    /// them.
    func testStaleServerBadgesDoNotExtendTheStandardTotalAfterMidnight() {
        let now = Date()
        let yesterday = now.addingTimeInterval(-36 * 3600)
        let previous = backfilled(
            sessions: standardRun([-6, -5, -4, -3, -2, -1], from: now),
            serverStreak: 30,
            now: now
        )

        for (label, primary, second) in [
            ("primaryDoneToday", true, false),
            ("secondDoneToday", false, true)
        ] {
            let stale = WidgetDataStore.makeSnapshot(
                user: makeUser(id: "u1"),
                primaryDoneToday: primary,
                secondDoneToday: second,
                practiceDoneToday: false,
                primaryStandardDoneToday: false,
                now: now,
                flagsAsOf: yesterday,
                previous: previous
            )
            XCTAssertFalse(
                stale.standardDates.contains(localDay(0, from: now)),
                "a stale \(label) must not fold today into the standard-only set"
            )
            XCTAssertEqual(stale.streak, 30, "a stale \(label) must not extend the server total")
        }
    }

    /// Retiring the flags must also un-check the weekday rows they drive: a stale
    /// flag marking today is the milder sibling of the same wrong, and leaving it
    /// would show a check on a day the user has not sat.
    func testStaleFlagsDoNotCheckTodaysRow() {
        let now = Date()
        let stale = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: true,
            secondDoneToday: true,
            practiceDoneToday: true,
            primaryStandardDoneToday: true,
            now: now,
            flagsAsOf: now.addingTimeInterval(-36 * 3600)
        )
        XCTAssertFalse(stale.completedDates.contains(localDay(0, from: now)))
        XCTAssertFalse(stale.secondCompletedDates.contains(localDay(0, from: now)))
        XCTAssertFalse(stale.isTodayMarkedDone(now: now), "a new day starts unchecked")
    }

    /// `flagsAsOf` is opt-in: every caller that computes its flags fresh at the
    /// call site (and every existing test) omits it and keeps the original
    /// trust-the-flags behaviour.
    func testOmittingFlagsAsOfKeepsTrustingTheFlags() {
        let now = Date()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            primaryStandardDoneToday: true,
            now: now
        )
        XCTAssertTrue(snapshot.standardDates.contains(localDay(0, from: now)))
        XCTAssertTrue(snapshot.isTodayMarkedDone(now: now))
    }

    /// Re-scope, track axis: on a dual-track account the latest standard sit can
    /// be a *second-track* one, on a day Track One's row leaves blank. The anchor
    /// legitimately lands there — the server counts it, being track-agnostic —
    /// but the primary-only quick day after it still contributed nothing, so the
    /// total may not be attached to that run. Previously 11.
    func testSecondTrackAnchorIsNotExtendedByAPrimaryOnlyRun() {
        let now = Date()
        let sessions = standardRun([-6, -5, -4, -3, -2], from: now) + [
            session(date: localDay(-1, from: now), type: .standard, track: .second),
            session(date: localDay(0, from: now), type: .quick, track: .primary)
        ]
        let snapshot = backfilled(sessions: sessions, serverStreak: 10, now: now)

        XCTAssertEqual(
            snapshot.serverStreakDate,
            localDay(-1, from: now),
            "the server is track-agnostic, so the second-track sit anchors"
        )
        XCTAssertTrue(
            snapshot.standardDates.contains(localDay(-1, from: now)),
            "and for the same reason it belongs to the standard-only set"
        )
        XCTAssertFalse(
            snapshot.completedDates.contains(localDay(-1, from: now)),
            "precondition: Track One's row does not mark a second-track sit (#684)"
        )
        XCTAssertEqual(snapshot.streak, 10)
        XCTAssertNotEqual(snapshot.streak, 11, "a primary-only quick day may not extend it")
    }

    /// Re-scope, track axis (second half): a day carrying *both* a primary and a
    /// second-track standard sit is still one day. Anchored two days before that
    /// day with a quick-only day in between, the run the server counted ends at
    /// the double day — so it extends by exactly one, never two, and never past
    /// the quick-only day that broke it.
    func testDayWithBothTracksStandardSitsCountsOnce() {
        let now = Date()
        let sessions = standardRun([-6, -5, -4, -3], from: now) + [
            session(date: localDay(-2, from: now), type: .standard, track: .primary),
            session(date: localDay(-2, from: now), type: .standard, track: .second),
            session(date: localDay(-1, from: now), type: .quick, track: .primary),
            session(date: localDay(0, from: now), type: .standard, track: .primary)
        ]
        // A stale pair: the fetch that returned 10 counted through day -3.
        let snapshot = backfilled(
            sessions: sessions,
            serverStreak: 10,
            anchoredOn: localDay(-3, from: now),
            now: now
        )

        XCTAssertEqual(
            Set(snapshot.standardDates).count,
            snapshot.standardDates.count,
            "the standard set is keyed by day, so two sits on one day appear once"
        )
        XCTAssertEqual(snapshot.streak, 11)
        XCTAssertNotEqual(snapshot.streak, 12, "two standard sits on one day are still one day")
        XCTAssertNotEqual(snapshot.streak, 13, "a quick-only day ends the run the server counted")
    }

    /// The policy the whole fix rests on, asserted directly: standard sits only,
    /// on either track, completed, inside the window — and deliberately not the
    /// same population the rows draw.
    func testRecentCompletedStandardDatesIsStandardOnlyAndTrackAgnostic() {
        let now = Date()
        let sessions = [
            session(date: localDay(0, from: now), type: .standard, track: .primary),
            session(date: localDay(-2, from: now), type: .standard, track: .second),
            session(date: localDay(-3, from: now), type: .standard, track: nil), // pre-fork, treated as primary
            session(date: localDay(-1, from: now), type: .quick, track: .primary),
            session(date: localDay(-1, from: now), type: .breath, track: .primary),
            session(date: localDay(0, from: now), type: .standard, completed: false, track: .primary),
            session(date: localDay(-10, from: now), type: .standard, track: .primary)
        ]

        let standard = WidgetDataStore.recentCompletedStandardDates(from: sessions, now: now)
        XCTAssertEqual(
            standard,
            [localDay(0, from: now), localDay(-2, from: now), localDay(-3, from: now)]
        )

        // The rows are a different population on both axes, which is exactly why
        // the standard set has to be stored rather than derived from them.
        let rows = WidgetDataStore.recentCompletedPracticeDates(from: sessions, now: now)
        XCTAssertTrue(rows.primary.contains(localDay(-1, from: now)), "the row counts the quick sit")
        XCTAssertFalse(standard.contains(localDay(-1, from: now)), "the server does not")
        XCTAssertFalse(rows.primary.contains(localDay(-2, from: now)), "Track One's row skips the second-track sit")
        XCTAssertTrue(standard.contains(localDay(-2, from: now)), "the server counts it")
    }

    /// A snapshot written before this field shipped must decode, and must not be
    /// read as "every row day was a standard sit" — the days it stored carry no
    /// type, so none of them may extend the server total.
    func testDecodesLegacyBlobWithoutStandardDates() throws {
        let now = Date()
        let legacy: [String: Any] = [
            "isLoggedIn": true,
            "userId": "u1",
            "currentDay": 10,
            "secondTrackDay": 2,
            "dualTrackEnabled": false,
            "primaryDoneToday": false,
            "secondDoneToday": false,
            "practiceDoneToday": false,
            "streak": 12,
            "completedDates": (0...6).map { localDay(-$0, from: now) },
            "secondCompletedDates": [String](),
            "serverStreak": 10,
            "serverStreakDate": localDay(-2, from: now),
            "lastUpdated": now.timeIntervalSinceReferenceDate
        ]
        let data = try JSONSerialization.data(withJSONObject: legacy)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)

        XCTAssertEqual(decoded.standardDates, [], "the field is absent, not empty-by-accident")
        XCTAssertFalse(decoded.historyIsUnknown, "this writer did record history")

        let shown = WidgetDataStore.normalizedForDisplay(decoded, now: now)
        XCTAssertEqual(shown.weekRowStreak(now: now), 7, "precondition: the row reaches the window edge")
        XCTAssertEqual(shown.streak, 10, "an unknown session type may not extend the server total")
    }

    /// The fast, network-free path has no sessions to classify, so it folds today
    /// in from the per-track "standard sit done today" flags — never from
    /// `practiceDoneToday`, which a quick or breath sit also raises.
    func testFastPathFoldsTodayIntoStandardDatesOnlyForAStandardSit() {
        let now = Date()
        let today = WidgetDataStore.localDayString(now)
        func snapshot(
            primary: Bool,
            second: Bool,
            practice: Bool,
            primaryStandard: Bool = false
        ) -> WidgetData {
            WidgetDataStore.makeSnapshot(
                user: makeUser(id: "u1"),
                primaryDoneToday: primary,
                secondDoneToday: second,
                practiceDoneToday: practice,
                primaryStandardDoneToday: primaryStandard,
                now: now,
                previous: nil
            )
        }

        XCTAssertFalse(
            snapshot(primary: false, second: false, practice: true).standardDates.contains(today),
            "a quick or breath sit raises the practice flag but is not a standard sit"
        )
        XCTAssertTrue(snapshot(primary: true, second: false, practice: true).standardDates.contains(today))
        XCTAssertTrue(
            snapshot(primary: false, second: true, practice: false).standardDates.contains(today),
            "the server is track-agnostic, so a second-track standard sit counts"
        )
        // The local Track One signal folds on its own, before the Home badge that
        // confirms it — the moment `markPracticeDoneToday` writes the snapshot.
        XCTAssertTrue(
            snapshot(primary: false, second: false, practice: true, primaryStandard: true)
                .standardDates.contains(today),
            "a just-finished primary standard sit counts before getTracksDoneToday returns"
        )
    }

    /// The standard set is history in the same sense as the rows: carried forward
    /// when no fetch supplies one, and dropped outright on an account switch.
    func testMakeSnapshotCarriesForwardAndAccountScopesStandardDates() {
        let now = Date()
        let previous = backfilled(
            sessions: standardRun([-2, -1], from: now),
            serverStreak: 5,
            now: now
        )
        XCTAssertEqual(previous.standardDates, [localDay(-2, from: now), localDay(-1, from: now)])

        let carried = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "u1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(carried.standardDates, previous.standardDates)

        let switched = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "someone-else"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: previous
        )
        XCTAssertEqual(switched.standardDates, [], "another account's standard sits never carry over")
    }

    func testNormalizedForDisplayPrunesStandardDatesOutsideTheWindow() {
        let now = Date()
        let stale = Date(timeIntervalSinceNow: -60 * 60 * 24 * 3)
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 10,
            secondTrackDay: 1,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 3,
            completedDates: [localDay(-1, from: now)],
            secondCompletedDates: [],
            standardDates: [localDay(-30, from: now), localDay(-1, from: now)],
            lastUpdated: stale
        )
        let shown = WidgetDataStore.normalizedForDisplay(data, now: now)
        XCTAssertEqual(shown.standardDates, [localDay(-1, from: now)])
    }

    /// #679 property sweep, the canonical acceptance criterion as an inequality:
    /// whatever the widget shows may exceed the row only by way of the server
    /// total, and that total may only be raised by days the server itself counted.
    ///
    /// The oracle is deliberately *looser* than the implementation — it counts
    /// every standard day after the anchor rather than only the consecutive ones —
    /// so it bounds the result without restating the walk. Any leak of a
    /// practice-only day into the extension term breaks it.
    func testServerTotalIsOnlyExtendedByDaysThatProducedIt() {
        let now = Date()
        let days = (0..<7).map { localDay(-$0, from: now) } // newest -> oldest
        let anchors: [(Int, Int?)] = [(20, nil), (20, 0), (20, 1), (20, 3), (3, 5)]

        for mask in 0..<(1 << 7) {
            let keptOffsets = (0..<7).filter { mask & (1 << $0) != 0 }
            let kept = keptOffsets.map { days[$0] }
            // Every third kept day is the standard one, so each mask mixes days
            // that produced the server total with days that only fill the row.
            let standardOffsets = keptOffsets.filter { $0 % 3 == 0 }
            let standard = standardOffsets.map { days[$0] }

            for (serverStreak, anchorOffset) in anchors {
                let anchorDay = anchorOffset.map { days[$0] }
                let shown = WidgetDataStore.reconciledStreak(
                    completedDates: kept,
                    standardDates: standard,
                    serverStreak: serverStreak,
                    serverStreakDate: anchorDay,
                    now: now
                )
                let context = "mask=\(mask) anchor=\(String(describing: anchorOffset))"
                let rowRun = WidgetDataStore.historyStreak(completedDates: kept, now: now)
                // The most the anchor may ever contribute: the server total plus
                // every standard day newer than it. With no anchor at all, the row
                // is the only thing left to show.
                let ceiling = anchorOffset.map { offset in
                    max(rowRun, serverStreak + standardOffsets.filter { $0 < offset }.count)
                } ?? rowRun

                XCTAssertLessThanOrEqual(
                    shown,
                    ceiling,
                    "a day the server never counted extended the total (\(context))"
                )
                XCTAssertGreaterThanOrEqual(shown, rowRun, "streak below the row (\(context))")
            }
        }
    }
}
