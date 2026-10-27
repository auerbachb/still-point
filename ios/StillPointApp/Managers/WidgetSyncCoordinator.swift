import Foundation
import StillPointShared

/// #1061: the home-screen widget's foreground sync, extracted from `AppViewModel`:
/// the snapshot pushed after auth and completion events, and the week-history
/// backfill from `/api/sessions`. `AppViewModel` owns one per scene and forwards to
/// it (`AppViewModel+Widget.swift`).
///
/// Not `@Observable`: no view reads its state. It reads the practice-day flags and
/// the signed-in user from its owner at call time, and the backfill's closures read
/// them again when the fetch lands, so nothing here is a stale copy.
///
/// The backfill itself is `WidgetHistoryRefresher`, which the background refresh
/// also runs with an instance of its own (#663).
@MainActor
final class WidgetSyncCoordinator {
    /// Weak: `AppViewModel` owns this coordinator.
    private weak var owner: AppViewModel?

    /// This scene's widget history backfill: its in-flight fetch, and the marker
    /// that throttles the next one (#663). The background refresh runs the same
    /// backfill with one of its own (`BackgroundRefreshScheduler`).
    private let history = WidgetHistoryRefresher()

    init(owner: AppViewModel) {
        self.owner = owner
    }

    /// Drop the in-flight backfill and clear its marker, so the next refresh refetches.
    func cancelHistoryRefresh() {
        history.cancel()
    }

    /// Persist a widget snapshot to the App Group container and reload timelines.
    /// No network call. See `AppViewModel.syncWidgetData(signedOutCause:)`.
    func syncWidgetData(signedOutCause: WidgetDataStore.SignedOutCause) {
        guard let owner else { return }
        // Read site for all five flags, and the one every write path funnels
        // through — including the network-free `markPracticeDoneToday` that can
        // reach here first on a sit just after local midnight.
        owner.rollOverDoneTodayFlagsIfNeeded()
        let practiceNow = owner.creditedPracticeInstant()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: owner.currentUser,
            primaryDoneToday: owner.primaryDoneToday,
            // #684: the widget's Track Two row is driven by the practice flag, not
            // the server-derived Home badge, so a just-finished sit checks today
            // immediately on the fast (network-free) path.
            secondDoneToday: owner.secondPracticeDoneToday,
            practiceDoneToday: owner.practiceDoneToday,
            // #679: the Track One analogue of the line above — a standard sit that
            // just finished is known here before the Home badge learns of it, and
            // the standard-only set must see it now or the streak lags a round-trip.
            primaryStandardDoneToday: owner.primaryStandardDoneToday,
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
            // once-per-account-per-day throttle would suppress the fetch for the
            // rest of the day, leaving the row blank on a sign-out/sign-in.
            history.clearMarker()
            // #663: and withdraw the widget's background refresh, both the fetch
            // a run may have in flight and the pending request. A run refreshes
            // as the identity cached on this device, which the sign-out has just
            // cleared.
            BackgroundRefreshScheduler.cancelWidgetRefresh()
            BackgroundRefreshScheduler.reschedule()
        }
        WidgetTimelineReloader.reloadHabitWidget()
    }

    /// Backfill the widget's 7-day completion row from session history. See
    /// `AppViewModel.refreshWidgetWeekHistory()`.
    func refreshWidgetWeekHistory() {
        history.refresh(
            currentUser: { [weak self] in self?.owner?.currentUser },
            // The Home badge, read once the fetch lands. The background refresh
            // has no badge and reads the same fact from the fetched sessions.
            primaryDoneToday: { [weak self] _, _ in self?.owner?.primaryDoneToday ?? false },
            // #918: the instant `syncWidgetData()` stamps, so both snapshots keep
            // the practice day the 6:00 grace window holds open.
            snapshotInstant: { [weak self] _, _, landedAt in
                self?.owner?.creditedPracticeInstant(now: landedAt) ?? landedAt
            },
            didFetch: { [weak self] sessions in
                // #526: backfill tracking-controls unlock from history so existing
                // users who have a qualifying sit start in the unlocked state
                // (mirrors web's syncTrackingUnlockFromSessions).
                self?.owner?.trackingControlPrefsManager.syncTrackingUnlockFromSessions(sessions)
            }
        )
    }
}
