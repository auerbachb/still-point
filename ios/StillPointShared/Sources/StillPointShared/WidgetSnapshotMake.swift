import Foundation

// Building the widget snapshot, and re-deriving it for display.
//
// `makeSnapshot` turns in-memory app state into the snapshot the app saves.
// `normalizedForDisplay` runs on every widget read: it retires stale "done
// today" flags, prunes history to the window, and re-derives the streak.
// Concurrent writes are merged in `WidgetSnapshotWrite.swift` (#678).

extension WidgetDataStore {
    /// Build a widget snapshot from in-memory app state, adjusting streak without
    /// extra network calls by comparing against the last persisted snapshot.
    ///
    /// `completedPracticeDates` / `secondCompletedPracticeDates`, when supplied
    /// (from a real `getSessions()` fetch), become the authoritative 7-day
    /// completion sets for Track One and Track Two respectively. When omitted,
    /// the prior snapshot's dates are carried forward so the fast, network-free
    /// sync path never wipes history it can't recompute. Today is folded into a
    /// track only when that track's own "done today" flag is set, so completing
    /// either sit checks that row's box immediately (#684).
    ///
    /// `completedStandardDates` is the third set on the same footing: the days
    /// carrying a completed **standard** sit on either track (#679). It is not a
    /// row — nothing renders it — only the evidence that lets `serverStreak` be
    /// extended by days the server would itself have counted.
    ///
    /// #671: the streak is then *derived* from the union of those sets — the
    /// same evidence the rows draw — rather than accumulated from flag
    /// transitions, so a day the app never observed can no longer be silently
    /// dropped. It is extended past the window edge only by the server anchor or
    /// the previous snapshot's carried value, and only while the rows corroborate
    /// an unbroken run all the way back to that edge.
    ///
    /// `flagsAsOf` is the moment the four "done today" flags were last known to
    /// describe — the local day they are a statement *about*. Each of them folds
    /// today into a set below, so a flag carried across local midnight would
    /// claim a day it never earned. Supplying it retires the whole set the moment
    /// the day rolls over; omitting it keeps the historical "trust the flags"
    /// behaviour for callers that compute them fresh at the call site.
    public static func makeSnapshot(
        user: UserDTO?,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        practiceDoneToday: Bool,
        primaryStandardDoneToday: Bool = false,
        now: Date = Date(),
        flagsAsOf: Date? = nil,
        previous: WidgetData? = nil,
        completedPracticeDates: Set<String>? = nil,
        secondCompletedPracticeDates: Set<String>? = nil,
        completedStandardDates: Set<String>? = nil,
        serverStreak: Int? = nil,
        serverStreakDate: String? = nil
    ) -> WidgetData {
        guard let user else {
            return .loggedOut
        }

        // Every "done today" flag is a claim about ONE local day, and each one
        // folds *today* into a set below. Nothing downstream can tell a flag set
        // an hour ago from one set before midnight, so the check has to happen
        // here, once, before any of them is read.
        //
        // The exposure is not hypothetical. The flags live on `AppViewModel` and
        // used to be cleared in exactly one place — the top of
        // `refreshTracksDoneToday()`, a network round-trip. But the path that
        // matters most is deliberately network-free: finishing a sit calls
        // `markPracticeDoneToday` -> `syncWidgetData()` directly. So a sit at
        // 00:05 — a quick one, or one on the other track — reached this function
        // with yesterday's flags still raised and folded today into sets it had
        // not earned. For `standardDays` that is the #679 inflation itself: the
        // day joins the population `standardDaysAfterAnchor` walks, adding +1 to
        // the server total for a day with no standard sit. The row sets carry the
        // milder version of the same wrong: a check on a track that did not sit.
        //
        // Shadowing rather than renaming is deliberate — it retires the flags for
        // *every* use below (folds, `dayKeptToday`, and the stored badges alike)
        // instead of only the uses someone remembered to update.
        let flagsDescribeToday = flagsAsOf.map { isSameLocalDay($0, now) } ?? true
        let primaryDoneToday = flagsDescribeToday && primaryDoneToday
        let secondDoneToday = flagsDescribeToday && secondDoneToday
        let practiceDoneToday = flagsDescribeToday && practiceDoneToday
        let primaryStandardDoneToday = flagsDescribeToday && primaryStandardDoneToday

        // Nil unless the stored snapshot belongs to this same signed-in account —
        // another account's history and streak must never carry over.
        let prior = (previous ?? load()).flatMap { snapshot in
            snapshot.isLoggedIn && snapshot.userId == user.id ? snapshot : nil
        }

        let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now))
        var dates = windowedDates(
            authoritative: completedPracticeDates,
            carriedForward: prior?.completedDates,
            window: window
        )
        var secondDates = windowedDates(
            authoritative: secondCompletedPracticeDates,
            carriedForward: prior?.secondCompletedDates,
            window: window
        )
        // #679: the standard-only day set travels alongside the two row sets and
        // is carried forward and account-scoped exactly like them, so the days
        // allowed to extend `serverStreak` outlive the fetch that produced them.
        var standardDays = windowedDates(
            authoritative: completedStandardDates,
            carriedForward: prior?.standardDates,
            window: window
        )
        // Fold today in only on the synchronous fast path (no session set), where
        // the "done today" flags are always same-day fresh. The authoritative path
        // already carries today's real completion in the supplied set, so trusting
        // a possibly-stale flag there could wrongly check a new day if the async
        // fetch crossed local midnight.
        let today = localDayString(now)
        if completedPracticeDates == nil, practiceDoneToday {
            dates.insert(today)
        }
        if secondCompletedPracticeDates == nil, secondDoneToday {
            secondDates.insert(today)
        }
        // #679, same fast-path caveat: fold today into the standard set only when
        // no authoritative set was supplied. The signal is deliberately *not*
        // `practiceDoneToday` — that flag is also raised by a quick or breath sit,
        // and counting one of those here is the inflation this change removes.
        //
        // It needs a *standard-only* "sat today" signal that is also **local**, for
        // the same reason #684 drives the Track Two row from `secondPracticeDoneToday`
        // rather than the Home badge: `primaryDoneToday` is server-derived
        // (`getTracksDoneToday`), so immediately after a primary standard sit —
        // `markPracticeDoneToday` sets the local flag and calls `syncWidgetData()`
        // straight away — it is still false. Folding on it alone withheld the
        // extension until the next `refreshTracksDoneToday()` round-trip, so the
        // flame did not move when the user finished their sit.
        //
        // `primaryStandardDoneToday` is that local Track One signal (standard sits
        // only, unlike `practiceDoneToday`); `secondDoneToday` already carries the
        // local second-track flag from the same call site. The server badge stays in
        // the disjunction so a snapshot built from it alone — a refresh with no local
        // sit this launch — still folds. The server's policy is track-agnostic, so
        // the disjunction is exactly the day-level signal wanted.
        if completedStandardDates == nil,
           primaryStandardDoneToday || primaryDoneToday || secondDoneToday {
            standardDays.insert(today)
        }

        // The authoritative fetch supplies a fresh (streak, anchor) pair; the fast,
        // network-free path reuses the one already stored for this same account so
        // a sit today still extends a streak older than the 7-day rows.
        let resolvedServerStreak: Int?
        let resolvedServerStreakDate: String?
        if serverStreak != nil || serverStreakDate != nil {
            resolvedServerStreak = serverStreak
            resolvedServerStreakDate = serverStreakDate
        } else if let prior {
            resolvedServerStreak = prior.serverStreak
            resolvedServerStreakDate = prior.serverStreakDate
        } else {
            resolvedServerStreak = nil
            resolvedServerStreakDate = nil
        }

        // Day-credit rule (#684; cross-surface policy tracked in #679): the day is
        // kept when AT LEAST ONE track finished a sit. On a two-a-day schedule
        // either session alone preserves continuity — only a zero-sit day breaks
        // it. This matches exactly what `weekMarks(now:)` renders for today.
        let union = dates.union(secondDates)
        let dayKeptToday = union.contains(today) || practiceDoneToday || secondDoneToday
        let streak = resolvedStreak(
            userId: user.id,
            dayKeptToday: dayKeptToday,
            previous: prior,
            now: now,
            completedDays: union,
            standardDays: standardDays,
            serverStreak: resolvedServerStreak,
            serverStreakDate: resolvedServerStreakDate
        )

        return WidgetData(
            isLoggedIn: true,
            userId: user.id,
            currentDay: StillPoint.clampedCurrentDay(for: user),
            secondTrackDay: max(user.secondTrackDay, 1),
            dualTrackEnabled: user.dualTrackEnabled,
            longSessionPeriod: user.longSessionPeriod,
            recoveryTargetDay: user.recoveryTargetDay,
            recoveryCurrentStep: user.recoveryCurrentStep,
            recoveryTotalSteps: user.recoveryTotalSteps,
            primaryDoneToday: primaryDoneToday,
            secondDoneToday: secondDoneToday,
            practiceDoneToday: practiceDoneToday,
            streak: streak,
            completedDates: dates.sorted(),
            secondCompletedDates: secondDates.sorted(),
            standardDates: standardDays.sorted(),
            serverStreak: resolvedServerStreak,
            serverStreakDate: resolvedServerStreakDate,
            lastUpdated: now
        )
    }

    /// Authoritative set when supplied, else the carried-forward one, always
    /// clipped to the trailing window the rows can render.
    private static func windowedDates(
        authoritative: Set<String>?,
        carriedForward: [String]?,
        window: Set<String>
    ) -> Set<String> {
        if let authoritative {
            return authoritative.intersection(window)
        }
        if let carriedForward {
            return Set(carriedForward).intersection(window)
        }
        return []
    }

    /// Normalize persisted data for widget display: clear stale "done today"
    /// flags after local midnight, prune both tracks' history to the renderable
    /// window, and re-derive the streak from that history.
    ///
    /// #671: the streak is recomputed on *every* display (not only on a day
    /// rollover) so the number beside the rows is always the number they imply.
    /// The old rollover branch zeroed the streak whenever the previous snapshot's
    /// `practiceDoneToday` was false, wiping an intact streak the history plainly
    /// showed.
    public static func normalizedForDisplay(_ data: WidgetData, now: Date = Date()) -> WidgetData {
        guard data.isLoggedIn else { return data }

        let requiredSitsComplete = data.dualTrackEnabled
            ? (data.primaryDoneToday && data.secondDoneToday)
            : data.primaryDoneToday
        let grace = graceKeepsPreviousPracticeDay(
            lastUpdated: data.lastUpdated,
            now: now,
            requiredSitsComplete: requiredSitsComplete
        )
        let displayNow = grace ? data.lastUpdated : now

        var copy = data
        if !isSameLocalDay(data.lastUpdated, now) {
            // An unfinished day stays open until 6:00, so its done-today flags
            // survive midnight. History outside the window is still dropped.
            if !grace {
                copy.primaryDoneToday = false
                copy.secondDoneToday = false
                copy.practiceDoneToday = false
            }
            // Keep completion history bounded to the window the rows can render.
            let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: displayNow))
            copy.completedDates = data.completedDates.filter { window.contains($0) }
            copy.secondCompletedDates = data.secondCompletedDates.filter { window.contains($0) }
            // #679: the standard-only set is bounded by the same window. It is
            // only ever read between the anchor and today, both of which live
            // inside it, so pruning loses nothing the extension could have used.
            copy.standardDates = data.standardDates.filter { window.contains($0) }
        }
        // A snapshot written before #671 carries a historical `streak` but no
        // stored evidence for it: its `completedDates` and `serverStreak` keys
        // are both absent, so they decode to `[]` and `nil`. Recomputing from
        // that reads 0 -- not because the streak lapsed, but because the
        // evidence was never recorded -- which would zero every existing user's
        // widget the moment they upgraded, before the app next foregrounded.
        // The widget is exactly the surface that renders *without* the app
        // opening, so that is a visible regression in a change whose whole
        // purpose is to stop the streak being wrong.
        //
        // The distinction has to come from `historyIsUnknown`, which records
        // whether those keys were *present* at decode time. An `isEmpty` test
        // cannot make it: a snapshot written by this version also prunes to an
        // empty history once the user lapses past the window, and treating that
        // as "unknown" would keep a stale streak beside a blank row -- bug #671
        // itself. Provenance separates them; emptiness does not.
        //
        // Belt and braces: even for a legacy blob, skip recomputation only while
        // there is genuinely nothing to recompute from. Any evidence at all,
        // from either track or from the anchor, goes down the normal path.
        let historyIsUnrecorded = copy.historyIsUnknown
            && copy.completedDayUnion.isEmpty
            && copy.serverStreak == nil
        guard !historyIsUnrecorded else { return copy }

        // The snapshot is its own "previous": its stored streak is the only record
        // of days older than the window until the next authoritative fetch. A nil
        // `userId` fails the same-account check inside `resolvedStreak`, so an
        // unattributed blob carries nothing forward.
        copy.streak = resolvedStreak(
            userId: data.userId ?? "",
            dayKeptToday: copy.isTodayMarkedDone(now: displayNow),
            previous: data,
            now: displayNow,
            completedDays: copy.completedDayUnion,
            standardDays: Set(copy.standardDates),
            serverStreak: copy.serverStreak,
            serverStreakDate: copy.serverStreakDate
        )
        return copy
    }
}
