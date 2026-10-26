import Foundation
import StillPointShared

/// The home-screen widget: the snapshot pushed after auth and completion events, the
/// week-history backfill from `/api/sessions`, and the network-free "done today" path
/// a finished sit takes.
///
/// The backfill's task and throttle marker are stored properties, declared in
/// `AppViewModel.swift`.
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
            clearWidgetHistoryRefreshMarker()
        }
        WidgetTimelineReloader.reloadHabitWidget()
    }

    func clearWidgetHistoryRefreshMarker() {
        widgetHistoryRefreshUserId = nil
        widgetHistoryRefreshDay = nil
        widgetHistoryRefreshedAt = nil
    }

    /// #84 follow-up: backfill the widget's 7-day completion row from real
    /// session history so the weekday checkmarks reflect actual practice (not
    /// just days seen since install). Runs as a cancellable task off the auth/home
    /// path so it never blocks cold-start; a fetch failure keeps the
    /// locally-accumulated week that `syncWidgetData()` already wrote.
    func refreshWidgetWeekHistory() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1",
              let user = currentUser else { return }
        // `/api/sessions` is the full history, so don't refetch on every
        // foreground. Do refetch when the day or account changes, and again
        // after a few minutes, so a sit saved on the web is not stuck behind
        // a once-a-day in-memory guard (#663). Sign-out clears the marker.
        let attemptedAt = Date()
        guard WidgetDataStore.shouldRefreshWidgetHistory(
            userId: user.id,
            now: attemptedAt,
            lastUserId: widgetHistoryRefreshUserId,
            lastLocalDay: widgetHistoryRefreshDay,
            lastSuccessAt: widgetHistoryRefreshedAt
        ) else { return }
        let attemptUserId = user.id
        let attemptDay = WidgetDataStore.localDayString(attemptedAt)
        widgetHistoryRefreshUserId = attemptUserId
        widgetHistoryRefreshDay = attemptDay
        widgetHistoryRefreshedAt = attemptedAt

        widgetHistoryTask?.cancel()
        widgetHistoryTask = Task {
            // #678: the generation of the stored snapshot as it is *before* this
            // task suspends. Every `WidgetDataStore` write advances it, so if a
            // sit finishes — or `refreshTracksDoneToday()` learns from the server
            // that today is already done — while `getSessions()` is in flight,
            // the save below sees the move and merges onto that fresher snapshot
            // instead of overwriting it with this pre-await view. Read here
            // rather than outside the task so nothing can slip between the read
            // and the `await`.
            let baselineGeneration = WidgetDataStore.currentWriteGeneration()
            guard let result = try? await APIClient.shared.getSessions() else {
                // A cancelled attempt was replaced by a newer one. Only the
                // attempt that still owns the marker may clear it.
                if WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
                    cancelled: Task.isCancelled,
                    markerUserId: widgetHistoryRefreshUserId,
                    markerDay: widgetHistoryRefreshDay,
                    markerAttemptedAt: widgetHistoryRefreshedAt,
                    attemptUserId: attemptUserId,
                    attemptDay: attemptDay,
                    attemptedAt: attemptedAt
                ) {
                    clearWidgetHistoryRefreshMarker()
                }
                return
            }
            // Drop if superseded, or the account changed during the await.
            guard !Task.isCancelled,
                  let current = currentUser, current.id == user.id else { return }
            let now = Date()
            // #684: one completed-date set per track, so each weekday row is
            // backfilled from that track's own sits.
            let completed = WidgetDataStore.recentCompletedPracticeDates(from: result.sessions, now: now)
            // Derive today's completion from the fetched sessions (consistent with
            // `now`) rather than the in-memory flags, which could be stale past midnight.
            let today = WidgetDataStore.localDayString(now)
            let doneToday = completed.primary.contains(today)
            let secondDone = completed.second.contains(today)
            // #671: keep the server-computed streak (the same number the app and
            // web history show) instead of discarding it — it's the only source
            // that knows about days older than the widget's trailing-7 row. It is
            // anchored onto a day, so it can only ever extend a run both rows
            // already corroborate (#684 day-credit rule: either track keeps a day).
            let snapshot = WidgetDataStore.makeSnapshot(
                user: current,
                primaryDoneToday: primaryDoneToday,
                secondDoneToday: secondDone,
                practiceDoneToday: doneToday,
                now: now,
                // Deliberately no `flagsAsOf` here. The two flags above are derived
                // from `result.sessions` against this same `now`, so they are fresh
                // by construction — stamping the set would retire freshly-computed
                // truth if this fetch happened to span midnight. This path also
                // supplies the authoritative sets below, so none of the same-day
                // folds `flagsAsOf` guards are reachable from here.
                completedPracticeDates: completed.primary,
                secondCompletedPracticeDates: completed.second,
                // #679: the days that actually produced `result.stats.streak` —
                // completed standard sits on either track, the same policy web's
                // `calculateSessionStats` applies. Persisted so a later day may
                // extend that total only when the server would have counted it;
                // the rows above also count quick and breath sits, so extending
                // by them pushed the widget past the app and web.
                completedStandardDates: WidgetDataStore.recentCompletedStandardDates(
                    from: result.sessions,
                    now: now
                ),
                serverStreak: result.stats.streak,
                serverStreakDate: WidgetDataStore.serverStreakAnchorDate(from: result.sessions)
            )
            // Newest-wins (#678): merges rather than clobbers when the stored
            // snapshot moved during the fetch, and declines to write at all if
            // the container was cleared by a sign-out in the meantime.
            WidgetDataStore.save(snapshot, ifWriteGeneration: baselineGeneration, now: now)
            WidgetTimelineReloader.reloadHabitWidget()
            // #526: backfill tracking-controls unlock from history so existing users
            // who have a qualifying sit start in the unlocked state (mirrors web's
            // syncTrackingUnlockFromSessions).
            trackingControlPrefsManager.syncTrackingUnlockFromSessions(result.sessions)
        }
    }

    /// Mark today as done on the completed sit's own track and push an immediate
    /// widget snapshot, so that session's weekday row checks today right away
    /// rather than waiting for the other session (#684).
    /// Shared touchpoint with #590 completion-handler work — rebase carefully.
    func markPracticeDoneToday(sessionType: SessionType, track: Track) {
        // BEFORE the writes below, never after. This sit belongs to the current
        // local day; any flag still standing from yesterday does not. Rolling over
        // first retires those and re-stamps onto today, so the flag raised just
        // below survives the identical (now no-op) rollover inside
        // `syncWidgetData()`. Doing it afterwards would clear the very sit that
        // just finished.
        rollOverDoneTodayFlagsIfNeeded()
        switch sessionType {
        case .quick, .breath:
            // Quick and breath sits are Track One practice whichever track the
            // user launched them from — they have no second-track counterpart.
            practiceDoneToday = true
        case .standard:
            if track == .second {
                secondPracticeDoneToday = true
            } else {
                practiceDoneToday = true
                // #679: and record it as a *standard* sit. `practiceDoneToday` alone
                // cannot say so — quick and breath sits raise it too — and the
                // standard-only day set that extends `serverStreak` may only take
                // days the server would have counted. Without this the flame stood
                // still until `getTracksDoneToday` caught up.
                primaryStandardDoneToday = true
            }
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
        widgetHistoryTask?.cancel()
        clearWidgetHistoryRefreshMarker()
        syncWidgetData()
    }
}
