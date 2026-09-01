import Foundation

// #678: newest-wins writes for the shared widget snapshot.
//
// `WidgetDataStore` has one writer that must suspend before it writes: the
// `/api/sessions` backfill behind `AppViewModel.refreshWidgetWeekHistory()`. It
// captures the world, awaits a network round-trip, and then saves what it
// captured. Anything that writes a *fresher* snapshot during that await — a sit
// finishing, or `refreshTracksDoneToday()` learning from the server that today
// is already done — is silently undone when the backfill lands and overwrites
// with its pre-await view, unchecking today's box and dropping the streak by one
// until the next successful sync.
//
// The fix is a write generation stamped by the store on every save. A suspending
// writer records the generation it saw *before* awaiting and hands it back; a
// mismatch means someone else wrote meanwhile, and its snapshot is merged onto
// theirs rather than over them.
//
// Deliberately not solved by OR-ing `AppViewModel.practiceDoneToday` back in:
// that flag carries no day stamp, so a session left open across local midnight
// would carry yesterday's `true` into today. Everything merged below is keyed by
// a `yyyy-MM-dd` local day, or by a snapshot's own `lastUpdated`, so the
// rollover behaviour `makeSnapshot` protects is preserved.

extension WidgetDataStore {
    /// What a generation-checked save did (#678).
    public enum SnapshotWriteOutcome: Sendable, Equatable {
        /// Nothing else had written; the snapshot was stored as supplied.
        case stored
        /// A newer snapshot landed during the caller's `await`; the caller's
        /// snapshot was folded onto it instead of replacing it.
        case merged
        /// The stored snapshot was cleared while the caller was suspended — an
        /// authoritative sign-out (`shouldClearStoredSnapshot(on:)`). Nothing was
        /// written; a signed-out container is never re-populated from a fetch
        /// that outlived its session.
        case superseded
        /// The write itself failed (no shared container, or encoding failed).
        case failed
    }

    /// The write generation of the snapshot currently persisted, or `0` when
    /// none is. Read this *before* suspending, then pass it to
    /// `save(_:ifWriteGeneration:now:)` after the `await`.
    public static func currentWriteGeneration() -> Int {
        load()?.writeGeneration ?? 0
    }

    /// Save `snapshot` unless a different snapshot has been written since
    /// `expected` was observed, in which case merge onto the newer one.
    ///
    /// The whole decision is delegated to `resolveWrite`, which is pure and
    /// therefore unit-testable without a shared App Group container.
    @discardableResult
    public static func save(
        _ snapshot: WidgetData,
        ifWriteGeneration expected: Int,
        now: Date = Date()
    ) -> SnapshotWriteOutcome {
        let resolution = resolveWrite(
            incoming: snapshot,
            observedGeneration: expected,
            stored: load(),
            now: now
        )
        guard let toStore = resolution.snapshot else { return resolution.outcome }
        return persist(toStore) ? resolution.outcome : .failed
    }

    /// Pure core of `save(_:ifWriteGeneration:now:)`: given what the caller wants
    /// to write, the generation it observed before suspending, and what is
    /// actually stored now, decide what to persist.
    ///
    /// A `nil` snapshot in the result means "write nothing".
    public static func resolveWrite(
        incoming: WidgetData,
        observedGeneration: Int,
        stored: WidgetData?,
        now: Date = Date()
    ) -> (snapshot: WidgetData?, outcome: SnapshotWriteOutcome) {
        let storedGeneration = stored?.writeGeneration ?? 0
        guard storedGeneration != observedGeneration else {
            // Nobody wrote while the caller was away: its view is still current.
            return (stamped(incoming, after: storedGeneration), .stored)
        }
        guard let stored else {
            // The generation moved *and* there is nothing stored: the snapshot was
            // cleared, which only an authoritative sign-out does.
            return (nil, .superseded)
        }
        return (
            stamped(merged(late: incoming, onto: stored, now: now), after: storedGeneration),
            .merged
        )
    }

    /// Stamp the generation a snapshot will carry once written.
    static func stamped(_ snapshot: WidgetData, after previousGeneration: Int) -> WidgetData {
        var copy = snapshot
        // `&+` rather than `+`: a counter this long-lived should wrap rather than
        // trap, and a wrapped value is still unequal to the one observed before
        // the await, which is all the comparison needs.
        copy.writeGeneration = previousGeneration &+ 1
        return copy
    }

    /// Fold a late-arriving snapshot onto the newer one that superseded it.
    ///
    /// `newer` is the base — it holds the freshest user state — and `late`
    /// contributes only what it uniquely knows: the authoritative 7-day history
    /// its `/api/sessions` fetch just returned. The merge is additive on both
    /// tracks, so neither writer can un-check a day the other recorded, and the
    /// streak is re-derived from the merged rows rather than carried, keeping the
    /// #671 invariant that the number never contradicts what is drawn.
    ///
    /// The deliberate cost of being additive: on a merge, the fetch cannot
    /// *remove* a day the stored snapshot recorded. That is the right side to err
    /// on — a stored day only ever comes from a sit actually finished on this
    /// device, showing one the server has not yet acknowledged is the friendlier
    /// error, and the window clip below retires it within seven days anyway. An
    /// uncontested backfill still replaces history outright, so a genuine
    /// server-side correction lands on the next refresh.
    public static func merged(
        late: WidgetData,
        onto newer: WidgetData,
        now: Date = Date()
    ) -> WidgetData {
        // Another account's history must never cross over — the same check
        // `makeSnapshot` makes before adopting a prior snapshot.
        guard late.isLoggedIn, newer.isLoggedIn,
              let userId = newer.userId, late.userId == userId else {
            return newer
        }

        var result = newer

        // Both sets are `yyyy-MM-dd` local days, so unioning them is immune to the
        // midnight problem that rules out the in-memory flag: a day is recorded
        // against the day it happened. Clipping to the window keeps the blob
        // bounded exactly as `makeSnapshot` does.
        let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now))
        result.completedDates = Set(newer.completedDates)
            .union(late.completedDates)
            .intersection(window)
            .sorted()
        result.secondCompletedDates = Set(newer.secondCompletedDates)
            .union(late.secondCompletedDates)
            .intersection(window)
            .sorted()

        // Each snapshot's flags are day-stamped by its own `lastUpdated`, so
        // `isPrimaryCompleteForToday(at:)` and friends discard a flag set before
        // local midnight instead of letting it leak into today.
        result.primaryDoneToday = newer.isPrimaryCompleteForToday(at: now)
            || late.isPrimaryCompleteForToday(at: now)
        result.secondDoneToday = newer.isSecondCompleteForToday(at: now)
            || late.isSecondCompleteForToday(at: now)
        result.practiceDoneToday = newer.isPracticeCompleteForToday(at: now)
            || late.isPracticeCompleteForToday(at: now)

        let anchor = preferredAnchor(late: late, newer: newer)
        result.serverStreak = anchor.streak
        result.serverStreakDate = anchor.date
        result.lastUpdated = now

        // Re-derived, never carried: `reconciledStreak` admits the carried value
        // only while the merged row corroborates an unbroken run back to the
        // window edge, so a real lapse still wins. Taking the larger of the two
        // is what makes a backfill landing after a completion unable to regress
        // the streak.
        result.streak = reconciledStreak(
            completedDates: Array(result.completedDayUnion),
            practiceDoneToday: result.isTodayMarkedDone(now: now),
            serverStreak: anchor.streak,
            serverStreakDate: anchor.date,
            carriedStreak: max(newer.streak, late.streak),
            now: now
        )
        return result
    }

    /// The (streak, anchor day) pair to keep when merging two snapshots.
    ///
    /// The late snapshot carries a genuinely fresher server total, but it may
    /// have been computed before the sit the newer snapshot recorded, so it can
    /// name an *older* day. Prefer whichever anchor names the later local day —
    /// ISO `yyyy-MM-dd` strings order chronologically — and on a tie the larger
    /// total. `reconciledStreak` still admits the pair only when the anchor falls
    /// inside a run the rows corroborate, so a wrong guess here cannot invent a
    /// streak the row contradicts.
    static func preferredAnchor(
        late: WidgetData,
        newer: WidgetData
    ) -> (streak: Int?, date: String?) {
        guard let lateDate = late.serverStreakDate else {
            return (newer.serverStreak, newer.serverStreakDate)
        }
        guard let newerDate = newer.serverStreakDate else {
            return (late.serverStreak, lateDate)
        }
        if lateDate > newerDate { return (late.serverStreak, lateDate) }
        if newerDate > lateDate { return (newer.serverStreak, newerDate) }
        return (max(late.serverStreak ?? 0, newer.serverStreak ?? 0), lateDate)
    }
}
