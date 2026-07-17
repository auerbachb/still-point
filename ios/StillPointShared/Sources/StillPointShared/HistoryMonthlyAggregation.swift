import Foundation

public struct MonthlySummary: Sendable, Equatable {
    public let yearMonth: String
    public let label: String
    public let daysActive: Int
    public let daysInMonth: Int
    public let totalTimeSeconds: Int

    public init(
        yearMonth: String,
        label: String,
        daysActive: Int,
        daysInMonth: Int,
        totalTimeSeconds: Int
    ) {
        self.yearMonth = yearMonth
        self.label = label
        self.daysActive = daysActive
        self.daysInMonth = daysInMonth
        self.totalTimeSeconds = totalTimeSeconds
    }
}

public enum HistoryMonthlyAggregation {
    private static let monthLabelFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        df.dateFormat = "MMMM yyyy"
        return df
    }()

    private static let shortMonthLabelFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        df.dateFormat = "MMM yyyy"
        return df
    }()

    public static func yearMonthKey(year: Int, month: Int) -> String {
        String(format: "%04d-%02d", year, month)
    }

    private static func parseYearMonth(_ isoDate: String) -> (year: Int, month: Int) {
        let parts = isoDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2 else { return (0, 0) }
        return (parts[0], parts[1])
    }

    private static func daysInCalendarMonth(year: Int, month: Int) -> Int {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        components.calendar = utcCalendar
        components.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = utcCalendar.date(from: components),
              let range = utcCalendar.range(of: .day, in: .month, for: date) else { return 30 }
        return range.count
    }

    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    private static func monthLabel(year: Int, month: Int) -> String {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        components.hour = 12
        components.calendar = utcCalendar
        components.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = utcCalendar.date(from: components) else { return yearMonthKey(year: year, month: month) }
        return monthLabelFormatter.string(from: date)
    }

    private static func shortMonthLabel(year: Int, month: Int) -> String {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        components.hour = 12
        components.calendar = utcCalendar
        components.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = utcCalendar.date(from: components) else { return yearMonthKey(year: year, month: month) }
        return shortMonthLabelFormatter.string(from: date)
    }

    private static func groupAnySessionsByDate(
        _ sessions: [some HistorySessionTimeInput]
    ) -> [String: [any HistorySessionTimeInput]] {
        var map: [String: [any HistorySessionTimeInput]] = [:]
        for session in sessions {
            guard SessionCalendar.isValidSessionCalendarDate(session.sessionDate) else { continue }
            map[session.sessionDate, default: []].append(session)
        }
        return map
    }

    private static func aggregateMonthSummaryFromGrouped(
        byDate: [String: [any HistorySessionTimeInput]],
        year: Int,
        month: Int
    ) -> MonthlySummary {
        let ym = yearMonthKey(year: year, month: month)
        let dim = daysInCalendarMonth(year: year, month: month)
        var daysActive = 0
        var totalTimeSeconds = 0

        for day in 1...dim {
            let dd = String(format: "%02d", day)
            let isoDate = "\(ym)-\(dd)"
            guard let daySessions = byDate[isoDate], !daySessions.isEmpty else { continue }
            daysActive += 1
            for session in daySessions {
                totalTimeSeconds += HistorySessionTime.sessionTimeSeconds(session)
            }
        }

        return MonthlySummary(
            yearMonth: ym,
            label: monthLabel(year: year, month: month),
            daysActive: daysActive,
            daysInMonth: dim,
            totalTimeSeconds: totalTimeSeconds
        )
    }

    public static func aggregateMonthSummary(
        sessions: [some HistorySessionTimeInput],
        year: Int,
        month: Int
    ) -> MonthlySummary {
        aggregateMonthSummaryFromGrouped(
            byDate: groupAnySessionsByDate(sessions),
            year: year,
            month: month
        )
    }

    private static func advanceMonth(year: Int, month: Int, delta: Int) -> (year: Int, month: Int) {
        var y = year
        var m = month + delta
        while m < 1 {
            m += 12
            y -= 1
        }
        while m > 12 {
            m -= 12
            y += 1
        }
        return (y, m)
    }

    /// Trailing 12 calendar months ending with the month containing `todayIso`.
    public static func buildTrailing12MonthSummaries(
        sessions: [some HistorySessionTimeInput],
        todayIso: String
    ) -> [MonthlySummary] {
        let (todayYear, todayMonth) = parseYearMonth(todayIso)
        let start = advanceMonth(year: todayYear, month: todayMonth, delta: -11)
        let byDate = groupAnySessionsByDate(sessions)

        var summaries: [MonthlySummary] = []
        var y = start.year
        var m = start.month

        for _ in 0..<12 {
            summaries.append(aggregateMonthSummaryFromGrouped(byDate: byDate, year: y, month: m))
            (y, m) = advanceMonth(year: y, month: m, delta: 1)
        }

        return summaries
    }

    /// Short month label for compact grid cells (e.g. "Jul 2026").
    public static func formatShortMonthLabel(_ yearMonth: String) -> String {
        let (year, month) = parseYearMonth("\(yearMonth)-01")
        return shortMonthLabel(year: year, month: month)
    }

    /// One compact row per calendar month strictly before the month of `todayIso`.
    public static func buildPriorMonthSummaries(
        sessions: [some HistorySessionTimeInput],
        todayIso: String
    ) -> [MonthlySummary] {
        let (todayYear, todayMonth) = parseYearMonth(todayIso)
        let currentYm = yearMonthKey(year: todayYear, month: todayMonth)

        let validDates = sessions
            .map(\.sessionDate)
            .filter(SessionCalendar.isValidSessionCalendarDate)
        guard let earliest = validDates.min() else { return [] }

        let (startYear, startMonth) = parseYearMonth(earliest)
        let byDate = groupAnySessionsByDate(sessions)

        var summaries: [MonthlySummary] = []
        var y = startYear
        var m = startMonth

        while true {
            let ym = yearMonthKey(year: y, month: m)
            if ym >= currentYm { break }
            summaries.append(aggregateMonthSummaryFromGrouped(byDate: byDate, year: y, month: m))
            (y, m) = advanceMonth(year: y, month: m, delta: 1)
        }

        return summaries
    }
}
