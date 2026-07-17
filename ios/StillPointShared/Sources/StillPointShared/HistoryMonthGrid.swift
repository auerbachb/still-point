import Foundation

public enum MonthDayState: String, Sendable, Equatable {
    case future
    case today
    case meditated
    case missed
}

public struct MonthGridDay: Sendable, Equatable {
    public let isoDate: String
    public let dayOfMonth: Int
    public let state: MonthDayState
    /// Short labels per session that day, e.g. ["8m", "1m"].
    public let durationLabels: [String]

    public init(isoDate: String, dayOfMonth: Int, state: MonthDayState, durationLabels: [String]) {
        self.isoDate = isoDate
        self.dayOfMonth = dayOfMonth
        self.state = state
        self.durationLabels = durationLabels
    }
}

public enum MonthGridCell: Sendable, Equatable {
    case blank
    case day(MonthGridDay)
}

public struct CurrentMonthGrid: Sendable, Equatable {
    public let yearMonth: String
    public let monthLabel: String
    public let cells: [MonthGridCell]

    public init(yearMonth: String, monthLabel: String, cells: [MonthGridCell]) {
        self.yearMonth = yearMonth
        self.monthLabel = monthLabel
        self.cells = cells
    }
}

public enum HistoryMonthGrid {
    private static let monthLabelFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        df.dateFormat = "MMMM yyyy"
        return df
    }()

    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

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

    private static func weekdayUtc(_ isoDate: String) -> Int {
        let parts = isoDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return 0 }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.calendar = utcCalendar
        components.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = utcCalendar.date(from: components) else { return 0 }
        return utcCalendar.component(.weekday, from: date) - 1
    }

    private static func monthLabel(year: Int, month: Int) -> String {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        components.hour = 12
        components.calendar = utcCalendar
        components.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = utcCalendar.date(from: components) else {
            return HistoryMonthlyAggregation.yearMonthKey(year: year, month: month)
        }
        return monthLabelFormatter.string(from: date)
    }

    private static func sortSessionsChronologically(_ sessions: [any HistorySessionTimeInput]) -> [any HistorySessionTimeInput] {
        sessions.sorted { lhs, rhs in
            guard let a = lhs as? SessionDTO, let b = rhs as? SessionDTO else {
                return lhs.sessionDate < rhs.sessionDate
            }
            if a.sessionDate != b.sessionDate { return a.sessionDate < b.sessionDate }
            let aCreated = a.createdAt ?? ""
            let bCreated = b.createdAt ?? ""
            if aCreated != bCreated { return aCreated < bCreated }
            return a.id < b.id
        }
    }

    private static func groupSessionsByDate(
        _ sessions: [some HistorySessionTimeInput]
    ) -> [String: [any HistorySessionTimeInput]] {
        var map: [String: [any HistorySessionTimeInput]] = [:]
        for session in sessions {
            guard SessionCalendar.isValidSessionCalendarDate(session.sessionDate) else { continue }
            map[session.sessionDate, default: []].append(session)
        }
        return map
    }

    private static func dayState(_ isoDate: String, todayIso: String, hasSession: Bool) -> MonthDayState {
        if isoDate > todayIso { return hasSession ? .meditated : .future }
        if isoDate == todayIso { return hasSession ? .meditated : .today }
        return hasSession ? .meditated : .missed
    }

    /// Format sit length for calendar cells — minutes when ≥60s, else seconds.
    public static func formatSessionDurationLabel(_ seconds: Int) -> String {
        let safeSeconds = max(seconds, 0)
        if safeSeconds < 60 { return "\(safeSeconds)s" }
        if safeSeconds >= 3600 {
            let hours = safeSeconds / 3600
            let minutes = (safeSeconds % 3600) / 60
            if minutes == 0 { return "\(hours)h" }
            return "\(hours)h \(minutes)m"
        }
        let minutes = Int((Double(safeSeconds) / 60.0).rounded())
        if minutes >= 60 { return "1h" }
        return "\(minutes)m"
    }

    /// Human-readable total time for summary rows.
    public static func formatTotalTime(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds)s" }
        let hours = seconds / 3600
        let minutes = hours == 0
            ? Int((Double(seconds) / 60.0).rounded())
            : (seconds % 3600) / 60
        if hours == 0 {
            if minutes >= 60 { return "1h" }
            return "\(minutes)m"
        }
        if minutes == 0 { return "\(hours)h" }
        return "\(hours)h \(minutes)m"
    }

    /// Builds a Sunday-start month grid for the calendar month containing `todayIso`.
    /// Any session on a day (including quick sits) marks the cell meditated (#379/#83).
    public static func buildCurrentMonthGrid(
        sessions: [some HistorySessionTimeInput],
        todayIso: String
    ) -> CurrentMonthGrid {
        let (year, month) = parseYearMonth(todayIso)
        let ym = HistoryMonthlyAggregation.yearMonthKey(year: year, month: month)
        let byDate = groupSessionsByDate(sessions)
        let dim = daysInCalendarMonth(year: year, month: month)
        let firstIso = "\(ym)-01"
        let leadingBlanks = weekdayUtc(firstIso)

        var cells: [MonthGridCell] = []
        for _ in 0..<leadingBlanks {
            cells.append(.blank)
        }

        for day in 1...dim {
            let dd = String(format: "%02d", day)
            let isoDate = "\(ym)-\(dd)"
            let daySessions = sortSessionsChronologically(byDate[isoDate] ?? [])
            let durationLabels = daySessions.map {
                formatSessionDurationLabel(HistorySessionTime.sessionTimeSeconds($0))
            }
            cells.append(.day(MonthGridDay(
                isoDate: isoDate,
                dayOfMonth: day,
                state: dayState(isoDate, todayIso: todayIso, hasSession: !daySessions.isEmpty),
                durationLabels: durationLabels
            )))
        }

        return CurrentMonthGrid(
            yearMonth: ym,
            monthLabel: monthLabel(year: year, month: month),
            cells: cells
        )
    }

    public static func buildPriorMonthSummaries(
        sessions: [some HistorySessionTimeInput],
        todayIso: String
    ) -> [MonthlySummary] {
        HistoryMonthlyAggregation.buildPriorMonthSummaries(sessions: sessions, todayIso: todayIso)
    }
}
