import Foundation
import StillPointShared

/// The widget's week-history backfill (#84, #663). It fetches `GET /api/sessions`,
/// rebuilds the snapshot from that history, saves it newest-wins, and reloads the
/// widget.
///
/// There is one instance per requester, and each has its own in-flight fetch and
/// throttle marker. Every `AppViewModel` scene owns one, and the background
/// refresh owns one (`BackgroundRefreshScheduler`), so both run this same code.
/// They need no shared lock to avoid clobbering each other. The store's write
/// generation (#678) makes whichever save lands second merge onto the first
/// instead of overwriting it. That guard already arbitrates between two
/// windows' backfills.
@MainActor
final class WidgetHistoryRefresher {
    /// In-flight fetch. It is cancelled before a new one starts, so a slow
    /// earlier fetch can't overwrite a newer snapshot out of order.
    private var task: Task<Bool, Never>?
    /// Account and local day of the last attempt, plus when it started. A new
    /// day or another account always refetches. The same account refetches after
    /// `widgetHistoryRefreshInterval`, so a sit finished on the web shows up the
    /// next time this app is foregrounded (#663).
    private var markerUserId: String?
    private var markerDay: String?
    private var markerAttemptedAt: Date?

    /// Let the next `refresh` fetch however recent the last attempt was.
    func clearMarker() {
        markerUserId = nil
        markerDay = nil
        markerAttemptedAt = nil
    }

    /// Drop the in-flight fetch and clear the marker, so the next `refresh`
    /// refetches. A cancelled attempt never clears the marker itself, because
    /// a cancel usually means a newer attempt has taken the marker over. A
    /// cancel that starts nothing new therefore has to clear it here.
    func cancel() {
        task?.cancel()
        task = nil
        clearMarker()
    }

    /// Start a backfill unless the marker says the last one is still fresh.
    ///
    /// - Parameters:
    ///   - currentUser: The account signed in now. It is read before the fetch
    ///     and again after it, so a result that outlived its session is dropped.
    ///   - primaryDoneToday: Track One's "standard sit done today" for the
    ///     snapshot, read after the fetch. It is given the fetched sessions and
    ///     the moment the snapshot describes.
    ///   - didFetch: Runs after a successful fetch, with the sessions it returned.
    /// - Returns: The started fetch, which yields whether its snapshot reached the
    ///   store. `nil` means nothing started: nobody is signed in, the last attempt
    ///   is still fresh, or the app is running UI tests.
    @discardableResult
    func refresh(
        currentUser: @escaping @MainActor () -> UserDTO?,
        primaryDoneToday: @escaping @MainActor (_ sessions: [SessionDTO], _ now: Date) -> Bool,
        didFetch: @escaping @MainActor (_ sessions: [SessionDTO]) -> Void = { _ in }
    ) -> Task<Bool, Never>? {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1",
              let user = currentUser() else { return nil }
        // `/api/sessions` is the full history, so don't refetch on every
        // foreground. Do refetch when the day or account changes, and again
        // after a few minutes, so a sit saved on the web is not stuck behind
        // a once-a-day in-memory guard (#663). Sign-out clears the marker.
        let attemptedAt = Date()
        guard WidgetDataStore.shouldRefreshWidgetHistory(
            userId: user.id,
            now: attemptedAt,
            lastUserId: markerUserId,
            lastLocalDay: markerDay,
            lastSuccessAt: markerAttemptedAt
        ) else { return nil }
        let attemptUserId = user.id
        let attemptDay = WidgetDataStore.localDayString(attemptedAt)
        markerUserId = attemptUserId
        markerDay = attemptDay
        markerAttemptedAt = attemptedAt

        task?.cancel()
        let attempt = Task { () -> Bool in
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
                    markerUserId: markerUserId,
                    markerDay: markerDay,
                    markerAttemptedAt: markerAttemptedAt,
                    attemptUserId: attemptUserId,
                    attemptDay: attemptDay,
                    attemptedAt: attemptedAt
                ) {
                    clearMarker()
                }
                return false
            }
            // Drop if superseded, or the account changed during the await.
            guard !Task.isCancelled,
                  let current = currentUser(), current.id == user.id else { return false }
            let now = Date()
            let snapshot = WidgetDataStore.makeHistorySnapshot(
                user: current,
                primaryDoneToday: primaryDoneToday(result.sessions, now),
                sessions: result.sessions,
                serverStreak: result.stats.streak,
                now: now
            )
            // Newest-wins (#678): merges rather than clobbers when the stored
            // snapshot moved during the fetch, and declines to write at all if
            // the container was cleared by a sign-out in the meantime.
            let outcome = WidgetDataStore.save(snapshot, ifWriteGeneration: baselineGeneration, now: now)
            WidgetTimelineReloader.reloadHabitWidget()
            didFetch(result.sessions)
            // #663: count the next background refresh from this one.
            BackgroundRefreshScheduler.reschedule()
            return outcome == .stored || outcome == .merged
        }
        task = attempt
        return attempt
    }
}
