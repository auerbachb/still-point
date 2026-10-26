import Foundation

// The widget's weekday rows and the "done today" checks they read.
//
// Each row is the trailing 7-day window ending on the caller's local "today"
// (#84, #684); before 6:00, an unfinished previous day still counts as today
// (#767). The rows and the checks both depend on the private
// `requiredStandardSitsComplete`, so they share one file.

/// One column in the widget's Duolingo-style weekday row: a single-letter
/// weekday label plus whether any counted practice was completed that day.
public struct WidgetDayMark: Sendable, Equatable, Identifiable {
    /// ISO local-day string (`yyyy-MM-dd`) this column represents.
    public let iso: String
    /// Narrow weekday initial (e.g. `M`, `T`, `W`) for the caller's locale.
    public let letter: String
    /// Full weekday name (e.g. `Monday`) for the VoiceOver label.
    public let weekdayName: String
    /// True when the sit this row represents was completed on `iso`.
    public let done: Bool
    /// True for the trailing column (the caller's local "today").
    public let isToday: Bool

    public var id: String { iso }

    public init(iso: String, letter: String, weekdayName: String, done: Bool, isToday: Bool) {
        self.iso = iso
        self.letter = letter
        self.weekdayName = weekdayName
        self.done = done
        self.isToday = isToday
    }
}

extension WidgetData {
    /// Whether the user has finished today's primary standard sit.
    /// Primary plus second when two-a-day is on. One finished sit does not close the day.
    private var requiredStandardSitsComplete: Bool {
        dualTrackEnabled ? (primaryDoneToday && secondDoneToday) : primaryDoneToday
    }

    /// During the pre-6:00 grace window, display "today" as the still-open previous day.
    private func practiceDisplayInstant(now: Date, calendar: Calendar) -> Date {
        if WidgetDataStore.graceKeepsPreviousPracticeDay(
            lastUpdated: lastUpdated,
            now: now,
            requiredSitsComplete: requiredStandardSitsComplete,
            calendar: calendar
        ) {
            return lastUpdated
        }
        return now
    }

    public func isPrimaryCompleteForToday(at now: Date = Date()) -> Bool {
        guard primaryDoneToday else { return false }
        if WidgetDataStore.isSameLocalDay(lastUpdated, now) { return true }
        return WidgetDataStore.graceKeepsPreviousPracticeDay(
            lastUpdated: lastUpdated,
            now: now,
            requiredSitsComplete: requiredStandardSitsComplete
        )
    }

    /// Whether the user has finished today's second-track standard sit (#684).
    public func isSecondCompleteForToday(at now: Date = Date()) -> Bool {
        guard secondDoneToday else { return false }
        if WidgetDataStore.isSameLocalDay(lastUpdated, now) { return true }
        return WidgetDataStore.graceKeepsPreviousPracticeDay(
            lastUpdated: lastUpdated,
            now: now,
            requiredSitsComplete: requiredStandardSitsComplete
        )
    }

    /// Whether the user has logged any counted Track One practice today
    /// (primary standard, quick, or breath).
    public func isPracticeCompleteForToday(at now: Date = Date()) -> Bool {
        guard practiceDoneToday else { return false }
        if WidgetDataStore.isSameLocalDay(lastUpdated, now) { return true }
        return WidgetDataStore.graceKeepsPreviousPracticeDay(
            lastUpdated: lastUpdated,
            now: now,
            requiredSitsComplete: requiredStandardSitsComplete
        )
    }

    /// **Day-credit rule (#684; cross-surface policy tracked in #679):** a local
    /// day is *kept* when **at least one** track recorded a completed sit that
    /// day. On a two-a-day schedule, finishing either session preserves
    /// continuity; only a day with zero sits breaks the streak. A partial day
    /// counts exactly like a full day — one day is one unit.
    public func isDayKeptToday(at now: Date = Date()) -> Bool {
        isPracticeCompleteForToday(at: now) || isSecondCompleteForToday(at: now)
    }

    /// Trailing 7-day window (oldest → newest, ending on the caller's local
    /// "today") of weekday marks for the single-row (single-track) layout. A day
    /// is checked when **either** track completed a sit, matching the day-credit
    /// rule in `isDayKeptToday(at:)`. Single-track users have no Track Two
    /// history, so this is identical to their Track One row.
    ///
    /// #671 reads the streak off exactly this row: on a two-a-day schedule the
    /// two rendered rows show, between them, precisely the days this union row
    /// marks, so "the run the row draws" is well-defined for both layouts.
    public func weekMarks(now: Date = Date(), calendar: Calendar = .current) -> [WidgetDayMark] {
        let anchor = practiceDisplayInstant(now: now, calendar: calendar)
        return weekMarks(
            completed: completedDayUnion,
            doneToday: isDayKeptToday(at: anchor),
            now: anchor,
            calendar: calendar
        )
    }

    /// Trailing 7-day window of weekday marks for one track's own row (#684).
    /// Each row reflects only its own track's completions, so the two rows show
    /// which individual session was hit and which was missed.
    public func weekMarks(
        for track: Track,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [WidgetDayMark] {
        let anchor = practiceDisplayInstant(now: now, calendar: calendar)
        switch track {
        case .primary:
            return weekMarks(
                completed: Set(completedDates),
                doneToday: isPracticeCompleteForToday(at: anchor),
                now: anchor,
                calendar: calendar
            )
        case .second:
            return weekMarks(
                completed: Set(secondCompletedDates),
                doneToday: isSecondCompleteForToday(at: anchor),
                now: anchor,
                calendar: calendar
            )
        }
    }

    /// Shared row builder: `doneToday` is the fallback for today's column when
    /// the snapshot's date set hasn't been rewritten yet (fast sync path).
    private func weekMarks(
        completed: Set<String>,
        doneToday: Bool,
        now: Date,
        calendar: Calendar
    ) -> [WidgetDayMark] {
        let start = calendar.startOfDay(for: now)
        let letters = WidgetData.narrowWeekdaySymbols(calendar: calendar)
        let names = WidgetData.fullWeekdaySymbols(calendar: calendar)
        return (0..<WidgetDataStore.historyWindowDays).reversed().compactMap { offset -> WidgetDayMark? in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: start) else { return nil }
            let iso = WidgetDataStore.localDayString(date, calendar: calendar)
            let isToday = offset == 0
            let done = completed.contains(iso) || (isToday && doneToday)
            let weekday = calendar.component(.weekday, from: date)
            let letter = letters.isEmpty ? "" : letters[(weekday - 1) % letters.count]
            let name = names.isEmpty ? "" : names[(weekday - 1) % names.count]
            return WidgetDayMark(iso: iso, letter: letter, weekdayName: name, done: done, isToday: isToday)
        }
    }

    /// Whether the weekday row's trailing column (today) renders as completed.
    /// Mirrors exactly what `weekMarks(now:)` decides — the union of both tracks
    /// under the #684 day-credit rule — so streak derivation and the rendered
    /// row(s) can never disagree about today (#671).
    public func isTodayMarkedDone(now: Date = Date(), calendar: Calendar = .current) -> Bool {
        completedDayUnion.contains(WidgetDataStore.localDayString(now, calendar: calendar))
            || isDayKeptToday(at: now)
    }

    /// Narrow standalone weekday initials indexed by `weekday - 1` (1 = Sunday).
    static func narrowWeekdaySymbols(calendar: Calendar) -> [String] {
        let df = DateFormatter()
        df.calendar = calendar
        df.locale = calendar.locale ?? Locale(identifier: "en_US")
        let symbols: [String]? = df.veryShortStandaloneWeekdaySymbols
        return symbols ?? ["S", "M", "T", "W", "T", "F", "S"]
    }

    /// Full standalone weekday names indexed by `weekday - 1` (1 = Sunday).
    static func fullWeekdaySymbols(calendar: Calendar) -> [String] {
        let df = DateFormatter()
        df.calendar = calendar
        df.locale = calendar.locale ?? Locale(identifier: "en_US")
        let symbols: [String]? = df.standaloneWeekdaySymbols
        return symbols ?? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    }
}
