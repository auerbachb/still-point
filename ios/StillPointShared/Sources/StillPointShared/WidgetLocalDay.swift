import Foundation

// Local-day helpers for the widget snapshot.
//
// Every history set the snapshot stores is a list of `yyyy-MM-dd` local-day
// strings, so the formatting here has to match how the app stamps
// `sessionDate`. The 6:00 grace rule (#767) lives here too: before 6:00, an
// unfinished practice day from the previous calendar day is still open.

extension WidgetDataStore {
    public static func isSameLocalDay(_ lhs: Date, _ rhs: Date) -> Bool {
        Calendar.current.isDate(lhs, inSameDayAs: rhs)
    }

    /// Before 6:00 local, a snapshot from the previous calendar day still describes
    /// the open practice day when a required sit is unfinished. A finished day
    /// rolls at midnight, and 6:00 always starts the new day.
    public static func graceKeepsPreviousPracticeDay(
        lastUpdated: Date,
        now: Date,
        requiredSitsComplete: Bool,
        calendar: Calendar = .current
    ) -> Bool {
        if requiredSitsComplete { return false }
        guard calendar.component(.hour, from: now) < SessionCalendar.graceCutoffHour else { return false }
        guard !calendar.isDate(lastUpdated, inSameDayAs: now) else { return false }
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now)) else {
            return false
        }
        return calendar.isDate(lastUpdated, inSameDayAs: yesterday)
    }

    /// The moment a widget snapshot describes, given whether the previous
    /// calendar day's required sits are finished. Before 6:00, while they are
    /// not, the previous day is still the open practice day, so this is an
    /// instant inside it: 23:00 on that day. A snapshot stamped there keeps the
    /// widget's grace display (`graceKeepsPreviousPracticeDay`), and its "done
    /// today" flags read that day. Otherwise it is `now`.
    ///
    /// The foreground's `creditedPracticeInstant(now:)` applies this to the app's
    /// own practice-day state, and both foreground writers stamp that instant:
    /// `syncWidgetData()` and the history refresh that follows it (#918). The
    /// background refresh reads the previous day's answer from the history it
    /// fetched instead (`practiceInstant(forHistory:)`).
    public static func practiceInstant(
        previousDayComplete: Bool,
        now: Date,
        calendar: Calendar = .current
    ) -> Date {
        let credited = SessionCalendar.effectiveLocalIsoDate(
            previousDayComplete: previousDayComplete,
            now: now,
            calendar: calendar
        )
        guard credited != SessionCalendar.localIsoDate(now: now, calendar: calendar) else { return now }
        return calendar.date(byAdding: .hour, value: -1, to: calendar.startOfDay(for: now)) ?? now
    }

    /// The moment a snapshot built from fetched `sessions` describes:
    /// `practiceInstant(previousDayComplete:now:calendar:)`, with the previous
    /// day's answer read from that history.
    ///
    /// The background refresh (#663) uses this. It has none of the foreground's
    /// practice-day state, so it reads whether the previous day is finished from
    /// the history it just fetched, with the predicate `/api/track/done-today`
    /// applies (`SessionCalendar.isDayComplete`).
    public static func practiceInstant(
        forHistory sessions: [SessionDTO],
        dualTrackEnabled: Bool,
        now: Date,
        calendar: Calendar = .current
    ) -> Date {
        let previousDay = SessionCalendar.localIsoDate(now: now, offsetDays: -1, calendar: calendar)
        let previousDayComplete = SessionCalendar.isDayComplete(
            sits: sessions.map { session in
                SessionCalendar.PracticeDaySit(
                    completed: session.completed,
                    isStandard: session.sessionType == .standard,
                    sessionDate: session.sessionDate,
                    track: session.track?.rawValue
                )
            },
            isoDay: previousDay,
            dualTrackEnabled: dualTrackEnabled
        )
        return practiceInstant(previousDayComplete: previousDayComplete, now: now, calendar: calendar)
    }

    /// Local-day `yyyy-MM-dd` for `date`, matching exactly how the app stamps
    /// `sessionDate` (`SessionViewModel.saveSession`): POSIX locale + an explicit
    /// **Gregorian** calendar, in the caller's timezone. Forcing Gregorian (rather
    /// than `Calendar.current`) keeps the digits aligned on devices whose preferred
    /// calendar is non-Gregorian (e.g. Buddhist/Japanese), so string equality with
    /// `sessionDate` still holds and real completions aren't dropped from the row.
    public static func localDayString(_ date: Date, calendar: Calendar = .current) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.calendar = Calendar(identifier: .gregorian)
        df.timeZone = calendar.timeZone
        df.dateFormat = "yyyy-MM-dd"
        return df.string(from: date)
    }

    /// The last `n` local-day strings, oldest → newest, ending on `now`'s day.
    public static func localDayStrings(lastN n: Int, endingAt now: Date = Date(), calendar: Calendar = .current) -> [String] {
        guard n > 0 else { return [] }
        let start = calendar.startOfDay(for: now)
        return (0..<n).reversed().compactMap { offset in
            calendar.date(byAdding: .day, value: -offset, to: start)
                .map { localDayString($0, calendar: calendar) }
        }
    }
}
