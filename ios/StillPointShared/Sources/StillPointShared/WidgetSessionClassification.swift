import Foundation

// Which completed sessions count toward which widget day set.
//
// The weekday rows and the server streak count different populations. The rows
// count quick and breath sits and split standard sits by track (#589, #684);
// the server counts only standard sits, on either track (#679). The predicates
// below state each policy once, and the helpers after them turn fetched
// sessions into the trailing-window day sets and the server-streak anchor that
// `makeSnapshot` stores.

extension WidgetDataStore {
    /// Whether a completed session counts toward the given track's widget row.
    ///
    /// Track One counts primary standard sits plus quick and breath sits (#589);
    /// Track Two counts second-track standard sits (#684). A session with no
    /// `track` predates the dual-track fork and is treated as primary. A focus
    /// session (#765) counts toward neither row. A completed standard combined sit
    /// (#769) counts toward both rows (`CombinedSit.tracksCredited`, #896), since
    /// each row means "this track's sit is done"; that is the one case to change to
    /// reverse it. One ended early fails the `completed` guard and marks neither.
    public static func sessionCountsForWidgetPractice(_ session: SessionDTO, track: Track) -> Bool {
        guard session.completed else { return false }
        switch track {
        case .primary:
            switch session.sessionType {
            case .quick, .breath:
                return true
            case .standard:
                return CombinedSit.tracksCredited(session).primary
            case .focus:
                // #839: focus is its own activity, not meditation practice, as on
                // the server (#835). This is the one case to change if focus days
                // should check the widget row; Track Two below takes standard sits
                // only either way.
                return false
            }
        case .second:
            guard session.sessionType == .standard else { return false }
            return CombinedSit.tracksCredited(session).second
        }
    }

    /// Track One convenience overload, preserving the pre-#684 call shape.
    public static func sessionCountsForWidgetPractice(_ session: SessionDTO) -> Bool {
        sessionCountsForWidgetPractice(session, track: .primary)
    }

    /// **Server streak policy (#679), stated once.** Whether a session is one the
    /// server counts toward `stats.streak`: a *completed* **standard** sit, on
    /// **either** track. Mirrors web's `calculateSessionStats`, which filters on
    /// `sessionType === "standard"` and never looks at `track`.
    ///
    /// Deliberately narrower than `sessionCountsForWidgetPractice(_:track:)` on
    /// one axis and wider on the other: the rows also count quick and breath sits
    /// (#589) but split standard sits by track (#684). Mixing the two populations
    /// is exactly the defect this predicate exists to prevent — every day used to
    /// extend `serverStreak` must be a day that contributed to it.
    public static func sessionCountsForServerStreak(_ session: SessionDTO) -> Bool {
        session.completed && session.sessionType == .standard
    }

    /// Whether `sessions` hold a completed **primary-track standard** sit on
    /// `day`. That is the fact `/api/track/done-today` reports as `primary`, and
    /// so what the Home badge `primaryDoneToday` means. A session with no `track`
    /// predates the dual-track fork and counts as primary, as it does for the rows.
    ///
    /// The background refresh (#663) has no Home badge to read, so it reads this
    /// from the history it just fetched instead.
    public static func primaryStandardSitCompleted(on day: String, in sessions: [SessionDTO]) -> Bool {
        sessions.contains { session in
            session.sessionDate == day
                && session.completed
                && session.sessionType == .standard
                && (session.track ?? .primary) == .primary
        }
    }

    /// The local days in the trailing 7-day window carrying a completed standard
    /// sit on either track — the set `reconciledStreak` may extend `serverStreak`
    /// with (#679). Pure and network-free so it's unit-testable; the caller
    /// supplies sessions, exactly as for `recentCompletedPracticeDates`.
    public static func recentCompletedStandardDates(
        from sessions: [SessionDTO],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Set<String> {
        let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now, calendar: calendar))
        var days = Set<String>()
        for session in sessions
        where window.contains(session.sessionDate) && sessionCountsForServerStreak(session) {
            days.insert(session.sessionDate)
        }
        return days
    }

    /// The local days in the trailing 7-day window on which each track recorded
    /// counted practice — Track One (primary standard, quick, breath) and Track
    /// Two (second-track standard). Pure and network-free so it's unit-testable;
    /// the caller supplies sessions. The window is the same for both rows; only
    /// the completion source is split by track (#684).
    public static func recentCompletedPracticeDates(
        from sessions: [SessionDTO],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> (primary: Set<String>, second: Set<String>) {
        let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now, calendar: calendar))
        var primary = Set<String>()
        var second = Set<String>()
        for session in sessions where window.contains(session.sessionDate) {
            if sessionCountsForWidgetPractice(session, track: .primary) {
                primary.insert(session.sessionDate)
            }
            if sessionCountsForWidgetPractice(session, track: .second) {
                second.insert(session.sessionDate)
            }
        }
        return (primary: primary, second: second)
    }

    /// The local day the server-computed `stats.streak` counts through: the most
    /// recent completed **standard** sit, matching the web's `calculateSessionStats`
    /// (which counts standard sessions only). Nil when there is no such sit.
    ///
    /// Deliberately track-agnostic, and now for the same reason on both sides
    /// (#679): the anchor and the days that may extend it are both selected by
    /// `sessionCountsForServerStreak(_:)`, so the population the anchor describes
    /// is precisely the population `serverStreak` counted. The rows stay
    /// practice-based and merely floor the result — they no longer feed the
    /// extension term, which is what let a quick-only day inflate a standard-only
    /// total.
    public static func serverStreakAnchorDate(from sessions: [SessionDTO]) -> String? {
        var latest: String?
        for session in sessions where sessionCountsForServerStreak(session) {
            if let current = latest, session.sessionDate <= current { continue }
            latest = session.sessionDate
        }
        return latest
    }
}
