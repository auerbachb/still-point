import XCTest
import StillPointShared

/// #678: a `/api/sessions` backfill that lands *after* a local completion must
/// not overwrite it. These drive the interleaving through the same calls the app
/// makes — `makeSnapshot` for each writer, then `resolveWrite` for the save —
/// so they fail if the ordering regresses, not just if the merge helper does.
final class WidgetSnapshotWriteTests: XCTestCase {
    private func makeUser(id: String = "user-1", currentDay: Int = 12) -> UserDTO {
        UserDTO(
            id: id,
            email: "test@example.com",
            username: "tester",
            isPublic: false,
            currentDay: currentDay
        )
    }

    private func localDay(_ offset: Int, from now: Date = Date()) -> String {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: now)!
        return WidgetDataStore.localDayString(date)
    }

    /// `snapshot` with the store-owned `writeGeneration` dropped, so a test can
    /// assert "every *other* field is exactly as supplied" without forging a
    /// field callers cannot set. Stripping the key and decoding restores it as
    /// `0` — the documented legacy default that
    /// `testLegacyBlobWithoutWriteGenerationDecodesAsZero` pins.
    private func withoutWriteGeneration(_ snapshot: WidgetData) throws -> WidgetData {
        let encoded = try JSONEncoder().encode(snapshot)
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any],
            "a WidgetData always encodes as a JSON object"
        )
        object.removeValue(forKey: "writeGeneration")
        let stripped = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder().decode(WidgetData.self, from: stripped)
    }

    /// The state on disk before either writer runs: three days practised, today
    /// still pending. Seeded through `resolveWrite` rather than by setting the
    /// generation directly, so it carries the stamp a real `save` would have
    /// given it (the store owns that field; callers cannot forge one).
    private func storedBeforeSit(now: Date, user: UserDTO) throws -> WidgetData {
        let base = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: [localDay(-3, from: now), localDay(-2, from: now), localDay(-1, from: now)],
            secondCompletedPracticeDates: [],
            serverStreak: 3,
            serverStreakDate: localDay(-1, from: now)
        )
        let (stamped, outcome) = WidgetDataStore.resolveWrite(
            incoming: base,
            observedGeneration: 0,
            stored: nil,
            now: now
        )
        XCTAssertEqual(outcome, .stored)
        var seeded = try XCTUnwrap(stamped)
        XCTAssertEqual(seeded.writeGeneration, 1)
        seeded.lastUpdated = now
        return seeded
    }

    // MARK: - The race

    /// The exact sequence from the issue: backfill reads the generation, the user
    /// finishes a sit and a fresher snapshot is written, then the pre-sit response
    /// lands. Today must stay checked and the streak must not drop.
    func testStaleBackfillArrivingAfterLocalCompletionKeepsTodayComplete() throws {
        let now = Date()
        let user = makeUser()
        let today = WidgetDataStore.localDayString(now)

        // 1. `refreshWidgetWeekHistory()` records what it sees, then suspends.
        let stored = try storedBeforeSit(now: now, user: user)
        let observed = stored.writeGeneration

        // 2. During the await the user finishes a sit: `markPracticeDoneToday()`
        //    plus `syncWidgetData()` write a snapshot with today complete.
        let afterSit = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: stored
        )
        let (savedAfterSit, sitOutcome) = WidgetDataStore.resolveWrite(
            incoming: afterSit,
            observedGeneration: observed,
            stored: stored,
            now: now
        )
        XCTAssertEqual(sitOutcome, .stored)
        let newer = try XCTUnwrap(savedAfterSit)
        XCTAssertTrue(newer.isTodayMarkedDone(now: now))
        XCTAssertEqual(newer.streak, 4)

        // 3. `getSessions()` returns a response captured before the sit — today is
        //    absent from it, and it carries one day the newer snapshot never saw.
        let fetched: Set<String> = [
            localDay(-5, from: now),
            localDay(-3, from: now),
            localDay(-2, from: now),
            localDay(-1, from: now)
        ]
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: newer,
            completedPracticeDates: fetched,
            secondCompletedPracticeDates: [],
            serverStreak: 3,
            serverStreakDate: localDay(-1, from: now)
        )
        // Left alone this is the regression: today unchecked, streak down one.
        XCTAssertFalse(late.isTodayMarkedDone(now: now))
        XCTAssertEqual(late.streak, 3)

        // 4. The generation moved under it, so the save merges instead.
        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: late,
            observedGeneration: observed,
            stored: newer,
            now: now
        )
        XCTAssertEqual(outcome, .merged)
        let merged = try XCTUnwrap(resolved)
        XCTAssertTrue(merged.completedDates.contains(today))
        XCTAssertTrue(merged.isTodayMarkedDone(now: now))
        XCTAssertTrue(merged.practiceDoneToday)
        XCTAssertEqual(merged.streak, 4, "the streak must not regress behind the newer snapshot")
        XCTAssertEqual(merged.weekMarks(now: now).last?.done, true)
        // The backfill's own contribution is kept, not discarded with the clobber.
        XCTAssertTrue(merged.completedDates.contains(localDay(-5, from: now)))
        XCTAssertTrue(merged.writeGeneration > newer.writeGeneration)
    }

    /// AC: the widget streak never regresses because a backfill finished late.
    func testMergeNeverLowersTheStoredStreak() {
        let now = Date()
        let user = makeUser()
        let newer = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil,
            completedPracticeDates: Set(WidgetDataStore.localDayStrings(lastN: 7, endingAt: now)),
            secondCompletedPracticeDates: [],
            serverStreak: 30,
            serverStreakDate: WidgetDataStore.localDayString(now)
        )
        // A much older view of the world: a single day, no server total.
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: [localDay(-1, from: now)],
            secondCompletedPracticeDates: []
        )
        XCTAssertLessThan(late.streak, newer.streak)
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        XCTAssertGreaterThanOrEqual(merged.streak, newer.streak)
    }

    /// Track Two completions are merged on their own row, not folded into Track One.
    func testMergeKeepsEachTracksOwnHistory() {
        let now = Date()
        let user = makeUser()
        let newer = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: true,
            practiceDoneToday: false,
            now: now,
            previous: nil
        )
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: [localDay(-1, from: now)],
            secondCompletedPracticeDates: [localDay(-2, from: now)]
        )
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        XCTAssertTrue(merged.completedDates.contains(localDay(-1, from: now)))
        XCTAssertTrue(merged.secondCompletedDates.contains(localDay(-2, from: now)))
        XCTAssertTrue(merged.secondCompletedDates.contains(WidgetDataStore.localDayString(now)))
        XCTAssertFalse(merged.completedDates.contains(localDay(-2, from: now)))
    }

    // MARK: - Midnight rollover

    /// The reason the in-memory flag was rejected as the fix: a snapshot written
    /// before local midnight must not check *today* just because its flag is set.
    /// Every input the merge reads is day-stamped, so it does not.
    func testMergeDoesNotCarryYesterdaysDoneFlagIntoToday() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let user = makeUser()

        // Written last night, mid-sit, with the flags set for *that* day.
        var staleNewer = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: true,
            secondDoneToday: true,
            practiceDoneToday: true,
            now: yesterday,
            previous: nil
        )
        staleNewer.lastUpdated = yesterday
        XCTAssertTrue(staleNewer.practiceDoneToday)

        // The backfill resolves after midnight; its response has no sit today.
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: [localDay(-1, from: now)],
            secondCompletedPracticeDates: []
        )

        let merged = WidgetDataStore.merged(late: late, onto: staleNewer, now: now)
        XCTAssertFalse(merged.practiceDoneToday, "yesterday's flag must not check today")
        XCTAssertFalse(merged.primaryDoneToday)
        XCTAssertFalse(merged.secondDoneToday)
        XCTAssertFalse(merged.isTodayMarkedDone(now: now))
        XCTAssertEqual(merged.weekMarks(now: now).last?.done, false)
        // Yesterday is day-stamped, so it survives the rollover on the row.
        XCTAssertTrue(merged.completedDayUnion.contains(localDay(-1, from: now)))
    }

    /// The pre-existing rollover cleanup is untouched by the new write path.
    func testNormalizedForDisplayStillClearsStaleDoneToday() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        var stale = WidgetDataStore.makeSnapshot(
            user: makeUser(),
            primaryDoneToday: true,
            secondDoneToday: true,
            practiceDoneToday: true,
            now: yesterday,
            previous: nil
        )
        stale.lastUpdated = yesterday
        let normalized = WidgetDataStore.normalizedForDisplay(stale, now: now)
        XCTAssertFalse(normalized.practiceDoneToday)
        XCTAssertFalse(normalized.primaryDoneToday)
        XCTAssertFalse(normalized.secondDoneToday)
    }

    // MARK: - Generation bookkeeping

    /// No competing write: the snapshot is stored exactly as supplied.
    func testUncontestedWriteStoresSnapshotUnchanged() throws {
        let now = Date()
        let user = makeUser()
        let stored = try storedBeforeSit(now: now, user: user)
        let incoming = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: stored
        )
        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: incoming,
            observedGeneration: stored.writeGeneration,
            stored: stored,
            now: now
        )
        XCTAssertEqual(outcome, .stored)
        let saved = try XCTUnwrap(resolved)
        // The store owns the stamp and advances it by exactly one...
        XCTAssertEqual(saved.writeGeneration, stored.writeGeneration + 1)
        // ...and rewrites nothing else: drop the store-owned field from both
        // sides and the snapshots are identical.
        XCTAssertEqual(
            try withoutWriteGeneration(saved),
            try withoutWriteGeneration(incoming)
        )
    }

    /// A first write with nothing stored is uncontested, not a conflict.
    func testFirstWriteWithNothingStoredIsUncontested() {
        let now = Date()
        let incoming = WidgetDataStore.makeSnapshot(
            user: makeUser(),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: incoming,
            observedGeneration: 0,
            stored: nil,
            now: now
        )
        XCTAssertEqual(outcome, .stored)
        XCTAssertEqual(resolved?.writeGeneration, 1)
    }

    /// Signing out clears the container; a fetch that outlived the session must
    /// not repopulate it.
    func testSnapshotClearedDuringFlightIsNotResurrected() {
        let now = Date()
        let late = WidgetDataStore.makeSnapshot(
            user: makeUser(),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: late,
            observedGeneration: 5,
            stored: nil,
            now: now
        )
        XCTAssertEqual(outcome, .superseded)
        XCTAssertNil(resolved)
    }

    /// Another account's history may never cross over in a merge.
    func testMergeAcrossAccountsKeepsTheStoredSnapshot() {
        let now = Date()
        let newer = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "user-1"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        let late = WidgetDataStore.makeSnapshot(
            user: makeUser(id: "user-2"),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: Set(WidgetDataStore.localDayStrings(lastN: 7, endingAt: now)),
            secondCompletedPracticeDates: []
        )
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        XCTAssertEqual(merged, newer)
    }

    /// A signed-out snapshot on either side is never merged into.
    func testMergeIgnoresSignedOutSnapshots() {
        let now = Date()
        let newer = WidgetDataStore.makeSnapshot(
            user: makeUser(),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        XCTAssertEqual(WidgetDataStore.merged(late: .loggedOut, onto: newer, now: now), newer)
        XCTAssertEqual(WidgetDataStore.merged(late: newer, onto: .loggedOut, now: now), .loggedOut)
    }

    /// The fresher server anchor wins; a stale one cannot drag the total down.
    func testMergePrefersTheLaterServerAnchor() {
        let now = Date()
        let user = makeUser()
        let allSevenDays = Set(WidgetDataStore.localDayStrings(lastN: 7, endingAt: now))
        let newer = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil,
            completedPracticeDates: allSevenDays,
            secondCompletedPracticeDates: [],
            serverStreak: 20,
            serverStreakDate: localDay(-1, from: now)
        )
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: allSevenDays,
            secondCompletedPracticeDates: [],
            serverStreak: 12,
            serverStreakDate: localDay(-4, from: now)
        )
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        XCTAssertEqual(merged.serverStreak, 20)
        XCTAssertEqual(merged.serverStreakDate, localDay(-1, from: now))
    }

    /// With no anchor of its own, the newer snapshot adopts the backfill's.
    func testMergeAdoptsTheBackfillAnchorWhenTheNewerSnapshotHasNone() {
        let now = Date()
        let user = makeUser()
        let allSevenDays = Set(WidgetDataStore.localDayStrings(lastN: 7, endingAt: now))
        let newer = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        XCTAssertNil(newer.serverStreak)
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: allSevenDays,
            secondCompletedPracticeDates: [],
            serverStreak: 40,
            serverStreakDate: localDay(-1, from: now)
        )
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        XCTAssertEqual(merged.serverStreak, 40)
        // 40 counted through yesterday, and the merged row shows today complete,
        // so the anchor extends by the one day since it was computed.
        XCTAssertEqual(merged.streak, 41)
    }

    /// Merging keeps the blob bounded to the renderable window.
    func testMergeClipsHistoryToTheWindow() {
        let now = Date()
        let user = makeUser()
        var newer = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        newer.completedDates = [localDay(-40, from: now)]
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: [localDay(-1, from: now)],
            secondCompletedPracticeDates: []
        )
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        XCTAssertFalse(merged.completedDates.contains(localDay(-40, from: now)))
        XCTAssertTrue(merged.completedDates.contains(localDay(-1, from: now)))
    }

    // MARK: - Persistence

    /// A blob written before write generations existed reads as generation 0.
    func testLegacyBlobWithoutWriteGenerationDecodesAsZero() throws {
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
            "completedDates": [],
            "lastUpdated": ref.timeIntervalSinceReferenceDate
        ]
        let data = try JSONSerialization.data(withJSONObject: legacy)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)
        XCTAssertEqual(decoded.writeGeneration, 0)
    }

    /// The generation survives a round trip, so a restart cannot reset it.
    func testWriteGenerationRoundTrips() throws {
        let now = Date()
        let (stamped, _) = WidgetDataStore.resolveWrite(
            incoming: WidgetDataStore.makeSnapshot(
                user: makeUser(),
                primaryDoneToday: false,
                secondDoneToday: false,
                practiceDoneToday: true,
                now: now,
                previous: nil
            ),
            observedGeneration: 11,
            stored: nil,
            now: now
        )
        XCTAssertNil(stamped, "a moved generation with nothing stored means a sign-out wipe")

        let (first, _) = WidgetDataStore.resolveWrite(
            incoming: WidgetDataStore.makeSnapshot(
                user: makeUser(),
                primaryDoneToday: false,
                secondDoneToday: false,
                practiceDoneToday: true,
                now: now,
                previous: nil
            ),
            observedGeneration: 0,
            stored: nil,
            now: now
        )
        let encoded = try JSONEncoder().encode(try XCTUnwrap(first))
        let decoded = try JSONDecoder().decode(WidgetData.self, from: encoded)
        XCTAssertEqual(decoded.writeGeneration, 1)
        XCTAssertEqual(decoded, first)
    }
}
