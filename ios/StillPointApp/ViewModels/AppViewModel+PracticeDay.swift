import Foundation
import StillPointShared

/// Which practice day it is and what has been sat on it: the done-today flags, their
/// midnight rollover, the 6:00 grace window that keeps an unfinished day open, and the
/// per-track refresh from the server.
///
/// The flags and the grace-window state live in `practiceDay`, a `PracticeDayState`
/// declared in `AppViewModel.swift`. Its rules are in StillPointShared (#894); the
/// server reads that feed it are here.
extension AppViewModel {
    func resetTrackCompletionBadges() {
        practiceDay.reset()
    }

    /// Practice day a new sit is stored on, and the `?date=` sent to `/api/auth/me`.
    func creditedSessionDate(now: Date = Date()) -> String {
        practiceDay.creditedSessionDate(now: now, dualTrack: dualTrackEnabled)
    }

    /// Instant `makeSnapshot` should treat as "now" so flags fold into the credited day.
    /// The rule is shared with the background refresh (`WidgetDataStore.practiceInstant`).
    func creditedPracticeInstant(now: Date = Date()) -> Date {
        practiceDay.creditedPracticeInstant(now: now, dualTrack: dualTrackEnabled)
    }

    /// Learns whether yesterday is finished. Before 6:00 an unknown answer keeps it open.
    private func resolvePreviousPracticeDay(now: Date) async {
        guard let ticket = practiceDay.beginPreviousDayRead(now: now) else { return }
        let yesterday = SessionCalendar.localIsoDate(now: now, offsetDays: -1)
        do {
            let tracks = try await APIClient.shared.getTracksDoneToday(date: yesterday)
            practiceDay.applyPreviousDayAnswer(tracks, ticket: ticket, now: now, dualTrack: dualTrackEnabled)
        } catch {
            practiceDay.applyFailedPreviousDayRead(ticket: ticket, now: now, dualTrack: dualTrackEnabled)
        }
    }

    /// Retire the "done today" flags when the local day has advanced past the one
    /// they describe, and re-stamp them onto the current day. Called before the
    /// flags are written and before they are read; see
    /// `PracticeDayState.rollOverIfNeeded(now:dualTrack:calendar:)` for why.
    func rollOverDoneTodayFlagsIfNeeded(now: Date = Date()) {
        practiceDay.rollOverIfNeeded(now: now, dualTrack: dualTrackEnabled)
    }

    /// #240: derive per-track "completed a standard sit today" from a lightweight
    /// server-side filtered query.
    func refreshTracksDoneToday() async {
        guard currentUser != nil else { return }
        // Captured before the request: the `currentUser` check above only holds at
        // entry, and everything below the await writes identity-scoped state
        // (Home badges, the widget snapshot, the week history). Re-checked after,
        // so a response that outlived its session cannot repaint badges or persist
        // a widget snapshot for an account that has signed out or been switched.
        let generation = authGeneration
        // #699: and a ticket for *this* refresh, taken before the request so it
        // records when this one left rather than when its answer happened to
        // arrive. The generation above cannot stand in — the refreshes racing here
        // all describe the same account, which is exactly the case it ignores.
        let ticket = tracksDoneOrdering.nextTicket()
        let now = Date()
        // Resolve yesterday before rolling flags. A nil stamp before 6:00 would
        // otherwise assume the day is finished and credit the new calendar date.
        await resolvePreviousPracticeDay(now: now)
        // Two rollovers, because they cover different evidence. The stamp-based
        // one below knows what *this process* claimed and when; the snapshot-based
        // one here also catches a relaunch that inherited a stored snapshot from a
        // previous day. Both are cheap and idempotent.
        rollOverDoneTodayFlagsIfNeeded(now: now)
        let prior = WidgetDataStore.load()
        let priorRequired = (prior?.dualTrackEnabled ?? false)
            ? ((prior?.primaryDoneToday ?? false) && (prior?.secondDoneToday ?? false))
            : (prior?.primaryDoneToday ?? true)
        if let prior, prior.isLoggedIn,
           !WidgetDataStore.isSameLocalDay(prior.lastUpdated, now),
           !WidgetDataStore.graceKeepsPreviousPracticeDay(
                lastUpdated: prior.lastUpdated,
                now: now,
                requiredSitsComplete: priorRequired
           ) {
            practiceDoneToday = false
            secondPracticeDoneToday = false
            // #679: same rollover as its siblings — yesterday's standard sit must
            // not fold today into the standard-only set.
            primaryStandardDoneToday = false
        }
        let today = creditedSessionDate(now: now)
        do {
            let tracksDoneToday = try await APIClient.shared.getTracksDoneToday(date: today)
            // Identity first, deliberately: a response that outlived its session is
            // not evidence about *this* one, and short-circuiting keeps it from
            // advancing the barrier against the refresh that is still live.
            guard generation == authGeneration,
                  tracksDoneOrdering.shouldApply(ticket: ticket, from: .read) else { return }
            // The Home badges, the #679 local flags (raised, never lowered) and, for
            // an answer about yesterday, the stamp. See
            // `PracticeDayState.applyTracksDoneAnswer(_:creditedDate:now:calendar:)`.
            practiceDay.applyTracksDoneAnswer(tracksDoneToday, creditedDate: today, now: now)
        } catch {
            // #759: a cancelled request is not a failed one, and only a failure
            // justifies what follows. Cancellation here always means replacement or
            // teardown — every call site that cancels this refresh constructs its
            // successor in the same run (`enterOfflineMode`,
            // `refreshAfterReconnectInBackground`, the login catch-up), and the one
            // that does not (`cancelIdentityScopedTasks`) is a session ending. So a
            // cancelled request has nothing to correct: clearing the badges and
            // persisting that at the `syncWidgetData()` below would fail closed on
            // behalf of a request that never asked the server anything, leaving the
            // widget briefly holding a value its replacement is about to overwrite.
            // Returning outright rather than skipping the clear alone, because the
            // snapshot write at the bottom is the half that reaches the widget.
            //
            // Deliberately asymmetric: the success path above has no matching
            // cancellation check. A cancelled request that nonetheless came back
            // with an answer holds real, current server data, and `shouldApply`
            // has already established it is the newest word on today. Dropping it
            // for being cancelled would throw away a fact nobody else is going to
            // supply — the same loss #699 fixed in the other direction. Only the
            // failure branch has nothing to contribute.
            if RequestCancellation.isCancellation(error, taskIsCancelled: Task.isCancelled) { return }
            // Non-fatal. #1021 (web parity with #961): the Home badges fall back
            // to the sits this app run remembers for the practice day — the #679
            // local standard-sit flags — instead of clearing. Those flags are
            // local truth: a sit finished on this device, possibly offline and
            // still queued for sync, or one an earlier badge answer reported. A
            // failed status request is not the server contradicting them, just an
            // absent answer, so a sit finished offline shows as done on Home, as
            // it does on web (`loadedSitsRef` in `useDualTrackFork.ts`). The flags
            // themselves are only read, never lowered: clearing them here (and
            // persisting that at the `syncWidgetData()` below) dropped a mark the
            // user had already earned, and could break the day's streak until
            // sync succeeded. Stale badges still do not leak: the fallback rolls
            // the flags over at the moment it reads them, so after midnight (or
            // 6:00 in the grace window) it shows neither track done.
            //
            // Ranked like the success path (#699), because only the *newest* word
            // on today may set the badges. An absent answer says nothing the
            // server has since confirmed is wrong, so a refresh that a later one
            // already superseded must not overwrite badges that newer one just set.
            //
            // Ranked but *not* recorded, which is why this asks `isSuperseded` and
            // the success path calls `shouldApply`. A failure observed nothing, so
            // consuming the barrier would let it bar an *earlier* refresh still in
            // flight — and that one comes back with real server data. Losing it is
            // the mirror of the bug above and just as visible: a sit is flushed,
            // `returnHome()`'s refresh is in flight, the network drops, the
            // reconnect refresh fails instantly and resets the badges, and then the
            // original success lands confirming the sit and is thrown away. A sit
            // on another device that only that answer reported stays dark until
            // some later refresh.
            guard generation == authGeneration,
                  !tracksDoneOrdering.isSuperseded(ticket: ticket) else { return }
            // At rest only, not mid-sit. `enterOfflineMode` deliberately keeps the
            // badges when a session is running, and it schedules this catch-up
            // moments later against the same dead network — so replacing them here
            // would undo that preservation for the very sit it was meant to
            // protect. Outside a session the fallback stands, and the next
            // successful refresh restores the server's truth either way. `Date()`
            // rather than `now`: the rollover is about when the flags are read,
            // and the request may have outlived the hour it left in.
            if !isInSession {
                practiceDay.applyFailedTracksDoneRead(now: Date(), dualTrack: dualTrackEnabled)
            }
        }
        // Both branches above return early on a generation change or a superseded
        // ticket, so reaching here means this refresh is both the live session's and
        // still the newest word on today. A superseded one skips these two with
        // nothing lost: the refresh that outranked it makes the same calls from a
        // strictly fresher answer, and drops the `getSessions()` backfill this one
        // would otherwise pay for a second time.
        //
        // A failure reaching here does not close the subject — it recorded nothing,
        // so an earlier refresh still in flight can land afterwards and run these
        // again from a real answer. That is the point: the second pass overwrites
        // the local-flags fallback snapshot this one is about to persist.
        syncWidgetData()
        refreshWidgetWeekHistory()
    }
}
