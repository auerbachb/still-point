import Foundation

// When the app refetches the widget's session history (#663): how long a
// successful `GET /api/sessions` fetch stays fresh, and whether a failed attempt
// still owns the marker it would clear.

extension WidgetDataStore {
    /// How long a successful widget-history fetch stays fresh for one account
    /// on one local day. A web sit has to show up the next time the phone app
    /// is foregrounded, so this is minutes rather than once per day (#663).
    public static let widgetHistoryRefreshInterval: TimeInterval = 5 * 60

    /// Whether a widget-history refresh (`WidgetHistoryRefresher.refresh`, run by
    /// `refreshWidgetWeekHistory` and the background refresh) should call
    /// `GET /api/sessions`.
    /// A new account or a new local day always fetches. The same account on
    /// the same day fetches again once `widgetHistoryRefreshInterval` has
    /// passed since the last success, and always retries when that success
    /// time was cleared after a failure.
    public static func shouldRefreshWidgetHistory(
        userId: String,
        now: Date,
        lastUserId: String?,
        lastLocalDay: String?,
        lastSuccessAt: Date?,
        calendar: Calendar = .current
    ) -> Bool {
        let day = localDayString(now, calendar: calendar)
        if lastUserId != userId || lastLocalDay != day {
            return true
        }
        guard let lastSuccessAt else { return true }
        return now.timeIntervalSince(lastSuccessAt) >= widgetHistoryRefreshInterval
    }

    /// A failed widget-history fetch may clear its marker only while this
    /// attempt still owns it. A cancelled attempt must not clear the marker,
    /// so an older request that finishes after a newer one started leaves the
    /// newer marker in place (#663).
    public static func failedAttemptOwnsWidgetHistoryMarker(
        cancelled: Bool,
        markerUserId: String?,
        markerDay: String?,
        markerAttemptedAt: Date?,
        attemptUserId: String,
        attemptDay: String,
        attemptedAt: Date
    ) -> Bool {
        if cancelled { return false }
        return markerUserId == attemptUserId
            && markerDay == attemptDay
            && markerAttemptedAt == attemptedAt
    }
}
