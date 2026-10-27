import Foundation
import StillPointShared

/// The home-screen widget: the snapshot pushed after auth and completion events, the
/// week-history backfill from `/api/sessions`, and the network-free "done today" path
/// a finished sit takes.
///
/// The backfill itself is `WidgetHistoryRefresher`, which the background refresh
/// also runs (#663). This scene's instance, `widgetHistory`, is a stored property
/// declared in `AppViewModel.swift`.
extension AppViewModel {
    /// Persist a widget snapshot to the App Group container and reload timelines.
    /// Called from auth + session-completion flows; no extra API calls.
    ///
    /// `signedOutCause` distinguishes a real sign-out (wipe the shared blob) from
    /// merely failing to reach the server at cold start — see #671 and
    /// `WidgetDataStore.shouldClearStoredSnapshot(on:)`.
    func syncWidgetData(signedOutCause: WidgetDataStore.SignedOutCause = .signedOut) {
        // Read site for all five flags, and the one every write path funnels
        // through — including the network-free `markPracticeDoneToday` that can
        // reach here first on a sit just after local midnight.
        rollOverDoneTodayFlagsIfNeeded()
        let practiceNow = creditedPracticeInstant()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: currentUser,
            primaryDoneToday: primaryDoneToday,
            // #684: the widget's Track Two row is driven by the practice flag, not
            // the server-derived Home badge, so a just-finished sit checks today
            // immediately on the fast (network-free) path.
            secondDoneToday: secondPracticeDoneToday,
            practiceDoneToday: practiceDoneToday,
            // #679: the Track One analogue of the line above — a standard sit that
            // just finished is known here before the Home badge learns of it, and
            // the standard-only set must see it now or the streak lags a round-trip.
            primaryStandardDoneToday: primaryStandardDoneToday,
            // Belt to the rollover's braces: the flags were just retired if the day
            // had turned, and this tells `makeSnapshot` the day they describe so it
            // refuses the same-day folds itself rather than trusting the caller.
            now: practiceNow,
            flagsAsOf: practiceNow
        )
        if snapshot.isLoggedIn {
            WidgetDataStore.save(snapshot)
        } else if WidgetDataStore.shouldClearStoredSnapshot(on: signedOutCause) {
            WidgetDataStore.clear()
            // #671: the next sign-in must re-backfill the week. Without this the
            // once-per-account-per-day throttle below would suppress the fetch for
            // the rest of the day, leaving the row blank on a sign-out/sign-in.
            widgetHistory.clearMarker()
            // #663: and withdraw the widget's background refresh, both the fetch
            // a run may have in flight and the pending request. A run refreshes
            // as the identity cached on this device, which the sign-out has just
            // cleared.
            BackgroundRefreshScheduler.cancelWidgetRefresh()
            BackgroundRefreshScheduler.reschedule()
        }
        WidgetTimelineReloader.reloadHabitWidget()
    }

    /// #84 follow-up: backfill the widget's 7-day completion row from real
    /// session history so the weekday checkmarks reflect actual practice (not
    /// just days seen since install). Runs as a cancellable task off the auth/home
    /// path so it never blocks cold-start; a fetch failure keeps the
    /// locally-accumulated week that `syncWidgetData()` already wrote.
    ///
    /// The fetch and the snapshot it writes are `WidgetHistoryRefresher`'s, the
    /// same code the background refresh runs while the app is closed (#663).
    func refreshWidgetWeekHistory() {
        widgetHistory.refresh(
            currentUser: { self.currentUser },
            // The Home badge, read once the fetch lands. The background refresh
            // has no badge and reads the same fact from the fetched sessions.
            primaryDoneToday: { _, _ in self.primaryDoneToday },
            // #918: the instant `syncWidgetData()` stamps, so both snapshots keep
            // the practice day the 6:00 grace window holds open.
            snapshotInstant: { _, _, landedAt in self.creditedPracticeInstant(now: landedAt) },
            didFetch: { sessions in
                // #526: backfill tracking-controls unlock from history so existing
                // users who have a qualifying sit start in the unlocked state
                // (mirrors web's syncTrackingUnlockFromSessions).
                self.trackingControlPrefsManager.syncTrackingUnlockFromSessions(sessions)
            }
        )
    }

    /// Mark today as done on the completed sit's own track and push an immediate
    /// widget snapshot, so that session's weekday row checks today right away
    /// rather than waiting for the other session (#684).
    /// Shared touchpoint with #590 completion-handler work — rebase carefully.
    func markPracticeDoneToday(sessionType: SessionType, track: Track) {
        // #839: a focus session is not meditation practice (#765). It checks no
        // widget row and raises none of the flags, so it leaves before
        // `recordCompletion` (and its rollover) and the widget refresh, as
        // `sessionCountsForWidgetPractice` does.
        if sessionType == .focus { return }
        // Rolls the flags over first, then raises this sit's own; see
        // `PracticeDayState.recordCompletion` for why the order matters.
        practiceDay.recordCompletion(
            sessionType: sessionType,
            track: track,
            now: Date(),
            dualTrack: dualTrackEnabled
        )
        // The Home badges (`primaryDoneToday` / `secondDoneToday`) stay
        // server-derived — this flag is the widget's own fast, network-free
        // path, and the two are refreshed from different sources.
        //
        // Drop any in-flight `refreshWidgetWeekHistory()` fetch first (same
        // pattern as `didLogout()`): a `getSessions()` call that started before
        // this sit finished returns without it, so there is no point paying for
        // the rest of it. Clearing the throttle key lets the next
        // `refreshTracksDoneToday()` re-fetch and backfill from history once
        // `returnHome()` has flushed the sit to the server.
        //
        // Not the guard against that fetch un-checking the row, though — it only
        // covers writers that know to cancel, and `refreshTracksDoneToday()`
        // raises `practiceDoneToday` from the server response and syncs without
        // one. The store-level write generation is what actually makes a late
        // backfill merge instead of overwrite (#678).
        widgetHistory.cancel()
        syncWidgetData()
    }
}
