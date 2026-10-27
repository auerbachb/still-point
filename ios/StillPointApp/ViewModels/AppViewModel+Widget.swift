import Foundation
import StillPointShared

/// The home-screen widget: the snapshot pushed after auth and completion events, the
/// week-history backfill from `/api/sessions`, and the network-free "done today" path
/// a finished sit takes.
///
/// #1061: the snapshot sync and the backfill are `WidgetSyncCoordinator`'s, owned by
/// this view model as `widgetSync` (declared in `AppViewModel.swift`). It owns this
/// scene's `WidgetHistoryRefresher`; the background refresh runs one of its own (#663).
extension AppViewModel {
    /// Persist a widget snapshot to the App Group container and reload timelines.
    /// Called from auth + session-completion flows; no extra API calls.
    ///
    /// `signedOutCause` distinguishes a real sign-out (wipe the shared blob) from
    /// merely failing to reach the server at cold start — see #671 and
    /// `WidgetDataStore.shouldClearStoredSnapshot(on:)`.
    func syncWidgetData(signedOutCause: WidgetDataStore.SignedOutCause = .signedOut) {
        widgetSync.syncWidgetData(signedOutCause: signedOutCause)
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
        widgetSync.refreshWidgetWeekHistory()
    }

    /// Mark today as done on the completed sit's own track and push an immediate
    /// widget snapshot, so that session's weekday row checks today right away
    /// rather than waiting for the other session (#684).
    /// Shared touchpoint with #590 completion-handler work — rebase carefully.
    ///
    /// - Parameter combined: #898, today's two sits done as one (#769). It counts
    ///   for both tracks (`CombinedSit.tracksCredited`), so it raises the flags a
    ///   standard sit raises on each track — Track One's and
    ///   `secondPracticeDoneToday` — before the one widget refresh below.
    func markPracticeDoneToday(sessionType: SessionType, track: Track, combined: Bool = false) {
        // #839: a focus session is not meditation practice (#765). It checks no
        // widget row and raises none of the flags, so it leaves before
        // `recordCompletion` (and its rollover) and the widget refresh, as
        // `sessionCountsForWidgetPractice` does. Which flags a sit raises is
        // `PracticeCompletionFlags.raised(sessionType:track:)` (#832); an empty set
        // is a session that raises none.
        if PracticeCompletionFlags.raised(sessionType: sessionType, track: track).isEmpty { return }
        // Rolls the flags over first, then raises this sit's own; see
        // `PracticeDayState.recordCompletion` for why the order matters.
        let now = Date()
        if combined {
            // A combined sit is a standard sit on the primary track; it also
            // checks Track Two's row as a second-track standard sit would.
            practiceDay.recordCompletion(sessionType: .standard, track: .primary, now: now, dualTrack: dualTrackEnabled)
            practiceDay.recordCompletion(sessionType: .standard, track: .second, now: now, dualTrack: dualTrackEnabled)
        } else {
            practiceDay.recordCompletion(
                sessionType: sessionType,
                track: track,
                now: now,
                dualTrack: dualTrackEnabled
            )
        }
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
        widgetSync.cancelHistoryRefresh()
        syncWidgetData()
    }
}
