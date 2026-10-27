import Foundation
import Testing
import StillPointShared

/// #678: a `/api/sessions` backfill that lands *after* a local completion must
/// not overwrite it. These drive the interleaving through the same calls the app
/// makes — `makeSnapshot` for each writer, then `resolveWrite` for the save —
/// so they fail if the ordering regresses, not just if the merge helper does.
struct WidgetSnapshotWriteTests {
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
        var object = try #require(
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
        #expect(outcome == .stored)
        var seeded = try #require(stamped)
        #expect(seeded.writeGeneration == 1)
        seeded.lastUpdated = now
        return seeded
    }

    // MARK: - The race

    /// The exact sequence from the issue: backfill reads the generation, the user
    /// finishes a sit and a fresher snapshot is written, then the pre-sit response
    /// lands. Today must stay checked and the streak must not drop.
    @Test func testStaleBackfillArrivingAfterLocalCompletionKeepsTodayComplete() throws {
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
        #expect(sitOutcome == .stored)
        let newer = try #require(savedAfterSit)
        #expect(newer.isTodayMarkedDone(now: now))
        #expect(newer.streak == 4)

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
        #expect(!late.isTodayMarkedDone(now: now))
        #expect(late.streak == 3)

        // 4. The generation moved under it, so the save merges instead.
        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: late,
            observedGeneration: observed,
            stored: newer,
            now: now
        )
        #expect(outcome == .merged)
        let merged = try #require(resolved)
        #expect(merged.completedDates.contains(today))
        #expect(merged.isTodayMarkedDone(now: now))
        #expect(merged.practiceDoneToday)
        #expect(merged.streak == 4, "the streak must not regress behind the newer snapshot")
        #expect(merged.weekMarks(now: now).last?.done == true)
        // The backfill's own contribution is kept, not discarded with the clobber.
        #expect(merged.completedDates.contains(localDay(-5, from: now)))
        #expect(merged.writeGeneration > newer.writeGeneration)
    }

    /// AC: the widget streak never regresses because a backfill finished late.
    @Test func testMergeNeverLowersTheStoredStreak() {
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
        #expect(late.streak < newer.streak)
        let merged = WidgetDataStore.merged(late: late, onto: newer, now: now)
        #expect(merged.streak >= newer.streak)
    }

    /// Track Two completions are merged on their own row, not folded into Track One.
    @Test func testMergeKeepsEachTracksOwnHistory() {
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
        #expect(merged.completedDates.contains(localDay(-1, from: now)))
        #expect(merged.secondCompletedDates.contains(localDay(-2, from: now)))
        #expect(merged.secondCompletedDates.contains(WidgetDataStore.localDayString(now)))
        #expect(!merged.completedDates.contains(localDay(-2, from: now)))
    }

    // MARK: - Midnight rollover

    /// The reason the in-memory flag was rejected as the fix: a snapshot written
    /// before local midnight must not check *today* just because its flag is set.
    /// Every input the merge reads is day-stamped, so it does not.
    @Test func testMergeDoesNotCarryYesterdaysDoneFlagIntoToday() {
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
        #expect(staleNewer.practiceDoneToday)

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
        #expect(!merged.practiceDoneToday, "yesterday's flag must not check today")
        #expect(!merged.primaryDoneToday)
        #expect(!merged.secondDoneToday)
        #expect(!merged.isTodayMarkedDone(now: now))
        #expect(merged.weekMarks(now: now).last?.done == false)
        // Yesterday is day-stamped, so it survives the rollover on the row.
        #expect(merged.completedDayUnion.contains(localDay(-1, from: now)))
    }

    /// The pre-existing rollover cleanup is untouched by the new write path.
    @Test func testNormalizedForDisplayStillClearsStaleDoneToday() {
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
        #expect(!normalized.practiceDoneToday)
        #expect(!normalized.primaryDoneToday)
        #expect(!normalized.secondDoneToday)
    }

    // MARK: - Generation bookkeeping

    /// No competing write: the snapshot is stored exactly as supplied.
    @Test func testUncontestedWriteStoresSnapshotUnchanged() throws {
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
        #expect(outcome == .stored)
        let saved = try #require(resolved)
        // The store owns the stamp and advances it by exactly one...
        #expect(saved.writeGeneration == stored.writeGeneration + 1)
        // ...and rewrites nothing else: drop the store-owned field from both
        // sides and the snapshots are identical.
        #expect(try withoutWriteGeneration(saved) == (try withoutWriteGeneration(incoming)))
    }

    /// A first write with nothing stored is uncontested, not a conflict.
    @Test func testFirstWriteWithNothingStoredIsUncontested() {
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
        #expect(outcome == .stored)
        #expect(resolved?.writeGeneration == 1)
    }

    /// Signing out clears the container; a fetch that outlived the session must
    /// not repopulate it.
    @Test func testSnapshotClearedDuringFlightIsNotResurrected() {
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
        #expect(outcome == .superseded)
        #expect(resolved == nil)
    }

    /// Another account's history may never cross over in a merge.
    @Test func testMergeAcrossAccountsKeepsTheStoredSnapshot() {
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
        #expect(merged == newer)
    }

    /// A signed-out snapshot on either side is never merged into.
    @Test func testMergeIgnoresSignedOutSnapshots() {
        let now = Date()
        let newer = WidgetDataStore.makeSnapshot(
            user: makeUser(),
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        #expect(WidgetDataStore.merged(late: .loggedOut, onto: newer, now: now) == newer)
        #expect(WidgetDataStore.merged(late: newer, onto: .loggedOut, now: now) == .loggedOut)
    }

    /// The fresher server anchor wins; a stale one cannot drag the total down.
    @Test func testMergePrefersTheLaterServerAnchor() {
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
        #expect(merged.serverStreak == 20)
        #expect(merged.serverStreakDate == localDay(-1, from: now))
    }

    /// With no anchor of its own, the newer snapshot adopts the backfill's.
    @Test func testMergeAdoptsTheBackfillAnchorWhenTheNewerSnapshotHasNone() {
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
        #expect(newer.serverStreak == nil)
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
        #expect(merged.serverStreak == 40)
        // 40 counted through yesterday, and the merged row shows today complete —
        // but nothing here says today's sit was a *standard* one, and 40 is a
        // standard-only total. Extending it by an unclassified practice day is
        // exactly the cross-surface inflation #679 removes, so the anchor is
        // adopted at its own value. (Before #679 this asserted 41.)
        #expect(merged.streak == 40)

        // With today recorded as a standard sit, the extension is legitimate and
        // the anchor does reach 41.
        let afterStandardSit = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: true,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: nil
        )
        let extended = WidgetDataStore.merged(late: late, onto: afterStandardSit, now: now)
        #expect(extended.streak == 41)
    }

    /// Merging keeps the blob bounded to the renderable window.
    @Test func testMergeClipsHistoryToTheWindow() {
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
        #expect(!merged.completedDates.contains(localDay(-40, from: now)))
        #expect(merged.completedDates.contains(localDay(-1, from: now)))
    }

    // MARK: - #679: the standard-only set merges like history, not like a flag

    /// The state a backfill leaves behind on the eve of a sit: six standard days
    /// ending yesterday, anchored on a server total older than the row. Seeded
    /// through `resolveWrite` so it carries a real store-stamped generation.
    private func storedBeforeStandardSit(now: Date, user: UserDTO) throws -> WidgetData {
        let week = Set((1...6).map { localDay(-$0, from: now) })
        let base = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: nil,
            completedPracticeDates: week,
            secondCompletedPracticeDates: [],
            completedStandardDates: week,
            serverStreak: 30,
            serverStreakDate: localDay(-1, from: now)
        )
        let (stamped, outcome) = WidgetDataStore.resolveWrite(
            incoming: base,
            observedGeneration: 0,
            stored: nil,
            now: now
        )
        #expect(outcome == .stored)
        var seeded = try #require(stamped)
        #expect(seeded.streak == 30, "precondition: the carried total is older than the row")
        seeded.lastUpdated = now
        return seeded
    }

    /// The #678 race, run against the new field: a backfill captured *before*
    /// today's standard sit lands after it. Its authoritative standard set does
    /// not know about today, so a "newest wins" merge would drop the very day
    /// that extended the streak. The union keeps it, and the streak holds at 31.
    @Test func testMergeKeepsTodaysStandardSitWhenALateBackfillLands() throws {
        let now = Date()
        let user = makeUser()
        let today = WidgetDataStore.localDayString(now)
        let stored = try storedBeforeStandardSit(now: now, user: user)
        let observed = stored.writeGeneration

        // The user finishes today's standard sit while `getSessions()` is away.
        let afterSit = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: true,
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
        #expect(sitOutcome == .stored)
        let newer = try #require(savedAfterSit)
        #expect(newer.standardDates.contains(today))
        #expect(newer.streak == 31)

        // The pre-sit response arrives: six standard days, today absent, plus one
        // older day this device never recorded.
        let fetched = Set((1...6).map { localDay(-$0, from: now) })
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: newer,
            completedPracticeDates: fetched,
            secondCompletedPracticeDates: [],
            completedStandardDates: fetched,
            serverStreak: 30,
            serverStreakDate: localDay(-1, from: now)
        )
        #expect(!late.standardDates.contains(today), "precondition: the fetch predates the sit")

        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: late,
            observedGeneration: observed,
            stored: newer,
            now: now
        )
        #expect(outcome == .merged)
        let merged = try #require(resolved)
        #expect(merged.standardDates.contains(today), "the sit's own day survives the late backfill")
        #expect(merged.standardDates.contains(localDay(-6, from: now)), "and the backfill's own days are kept, not discarded")
        #expect(merged.streak == 31, "the standard-only extension survives the merge")
    }

    /// The same interleaving with a *quick* sit today. The row still checks
    /// today, so the merged snapshot must not regress the rows — but nothing in
    /// the merge may let that day extend a standard-only server total (#679).
    @Test func testMergedStreakIsNotExtendedByAQuickSitToday() throws {
        let now = Date()
        let user = makeUser()
        let today = WidgetDataStore.localDayString(now)
        let stored = try storedBeforeStandardSit(now: now, user: user)
        let observed = stored.writeGeneration

        let afterQuickSit = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: true,
            now: now,
            previous: stored
        )
        let (savedAfterSit, _) = WidgetDataStore.resolveWrite(
            incoming: afterQuickSit,
            observedGeneration: observed,
            stored: stored,
            now: now
        )
        let newer = try #require(savedAfterSit)
        #expect(newer.completedDates.contains(today), "the row checks today")
        #expect(!newer.standardDates.contains(today), "but a quick sit is not a standard sit")

        let fetched = Set((1...6).map { localDay(-$0, from: now) })
        let late = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: false,
            practiceDoneToday: false,
            now: now,
            previous: newer,
            completedPracticeDates: fetched,
            secondCompletedPracticeDates: [],
            completedStandardDates: fetched,
            serverStreak: 30,
            serverStreakDate: localDay(-1, from: now)
        )
        let (resolved, outcome) = WidgetDataStore.resolveWrite(
            incoming: late,
            observedGeneration: observed,
            stored: newer,
            now: now
        )
        #expect(outcome == .merged)
        let merged = try #require(resolved)
        #expect(merged.completedDates.contains(today), "the merge is still additive on the rows")
        #expect(!merged.standardDates.contains(today))
        #expect(merged.streak == 30, "the quick day fills the row but not the server total")
    }

    // MARK: - Persistence

    /// A blob written before write generations existed reads as generation 0.
    @Test func testLegacyBlobWithoutWriteGenerationDecodesAsZero() throws {
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
        #expect(decoded.writeGeneration == 0)
    }

    /// The generation survives a round trip, so a restart cannot reset it.
    @Test func testWriteGenerationRoundTrips() throws {
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
        #expect(stamped == nil, "a moved generation with nothing stored means a sign-out wipe")

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
        let encoded = try JSONEncoder().encode(try #require(first))
        let decoded = try JSONDecoder().decode(WidgetData.self, from: encoded)
        #expect(decoded.writeGeneration == 1)
        #expect(decoded == first)
    }
}
