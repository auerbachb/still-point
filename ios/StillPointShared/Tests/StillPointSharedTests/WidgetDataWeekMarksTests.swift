import XCTest
import StillPointShared

final class WidgetDataWeekMarksTests: XCTestCase, WidgetDataTestSupport {
    // MARK: - #84 follow-up: weekday checkmark row

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

    /// A pre-#671 snapshot has a real `streak` but no stored history to justify
    /// it. Recomputing would read 0 -- not a lapse, just missing evidence -- and
    /// zero every existing user's widget the moment they upgraded, before the
    /// app next foregrounded. Unknown history must not be read as empty history.
    func testLegacySnapshotKeepsItsStreakUntilHistoryIsStored() throws {
        let ref = Date(timeIntervalSince1970: 1_700_000_000)
        let legacy: [String: Any] = [
            "isLoggedIn": true,
            "userId": "u1",
            "currentDay": 10,
            "secondTrackDay": 2,
            "dualTrackEnabled": false,
            "primaryDoneToday": false,
            "secondDoneToday": false,
            "streak": 42,
            "lastUpdated": ref.timeIntervalSinceReferenceDate
        ]
        let data = try JSONSerialization.data(withJSONObject: legacy)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)
        XCTAssertEqual(decoded.completedDates, [], "precondition: legacy blob stores no history")
        XCTAssertNil(decoded.serverStreak, "precondition: legacy blob stores no anchor")

        // `now` is far past lastUpdated, so the rollover branch also runs.
        let shown = WidgetDataStore.normalizedForDisplay(decoded, now: Date())
        XCTAssertEqual(shown.streak, 42, "legacy streak must survive until real history is stored")
        XCTAssertFalse(shown.practiceDoneToday, "stale done-today flags are still cleared")
    }

    /// The guard above must not become a way for a genuine lapse to persist: a
    /// snapshot written by *this* version always records `completedDates`, so an
    /// empty-but-present history alongside a server anchor still recomputes.
    func testEmptyHistoryWithAnchorStillRecomputesToZero() {
        let now = Date()
        let data = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 10,
            secondTrackDay: 2,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 42,
            completedDates: [],
            serverStreak: 3,
            serverStreakDate: localDay(-30, from: now),
            lastUpdated: now
        )
        let shown = WidgetDataStore.normalizedForDisplay(data, now: now)
        XCTAssertEqual(shown.streak, 0, "a lapsed run with no corroborating history reads zero")
    }

    /// The legacy carry-forward must key off *provenance*, not emptiness. A
    /// snapshot written by this version that has lapsed past the window prunes
    /// to exactly the shape of a legacy blob — no history, no anchor — and must
    /// still recompute to 0, or #671 is back: a stale streak beside a blank row.
    /// This is the case the 640-case property sweep caught; pinned by name here
    /// so the distinction cannot regress silently.
    func testEmptyHistoryWithoutAnchorRecomputesToZeroWhenHistoryWasRecorded() {
        let now = Date()
        let lapsed = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 10,
            secondTrackDay: 2,
            dualTrackEnabled: false,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            streak: 42,
            completedDates: [],
            serverStreak: nil,
            serverStreakDate: nil,
            lastUpdated: now
        )
        XCTAssertFalse(lapsed.historyIsUnknown, "precondition: this version records history")

        let shown = WidgetDataStore.normalizedForDisplay(lapsed, now: now)
        XCTAssertEqual(shown.weekMarks(now: now).filter(\.done).count, 0, "precondition: the row is blank")
        XCTAssertEqual(shown.streak, 0, "a blank row may never carry a streak")
    }

    /// The two shapes are indistinguishable by content, so assert directly that
    /// decoding is what separates them: keys absent means unknown, keys present
    /// (even empty) means recorded.
    func testHistoryIsUnknownTracksKeyPresenceNotEmptiness() throws {
        let ref = Date(timeIntervalSince1970: 1_700_000_000)
        var blob: [String: Any] = [
            "isLoggedIn": true,
            "userId": "u1",
            "currentDay": 10,
            "secondTrackDay": 2,
            "dualTrackEnabled": false,
            "primaryDoneToday": false,
            "secondDoneToday": false,
            "streak": 42,
            "lastUpdated": ref.timeIntervalSinceReferenceDate
        ]

        let legacy = try JSONDecoder().decode(
            WidgetData.self,
            from: try JSONSerialization.data(withJSONObject: blob)
        )
        XCTAssertTrue(legacy.historyIsUnknown, "no history keys at all means unknown history")

        // Same empty history, but explicitly recorded by the writer.
        blob["completedDates"] = [String]()
        let recorded = try JSONDecoder().decode(
            WidgetData.self,
            from: try JSONSerialization.data(withJSONObject: blob)
        )
        XCTAssertFalse(recorded.historyIsUnknown, "an explicitly empty history is known, not unknown")
        XCTAssertEqual(
            WidgetDataStore.normalizedForDisplay(recorded, now: Date()).streak,
            0,
            "a recorded empty history is a lapse and must recompute to zero"
        )

        // Provenance is never written back: re-encoding clears it.
        let roundTripped = try JSONDecoder().decode(WidgetData.self, from: try JSONEncoder().encode(legacy))
        XCTAssertFalse(roundTripped.historyIsUnknown, "saving a snapshot records its history")
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
}
