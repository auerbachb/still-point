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
