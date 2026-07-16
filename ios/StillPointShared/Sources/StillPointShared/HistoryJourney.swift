import Foundation

// MARK: - Calendar helpers (UTC date parts; matches `session_date` strings)

public enum SessionCalendar {
    private static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(secondsFromGMT: 0)!
        return c
    }()

    public static func addDays(toIsoDate isoDate: String, deltaDays: Int) -> String {
        let parts = isoDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return isoDate }
        var c = DateComponents()
        c.year = parts[0]
        c.month = parts[1]
        c.day = parts[2]
        c.calendar = utcCalendar
        c.timeZone = TimeZone(secondsFromGMT: 0)
        guard let base = c.date else { return isoDate }
        guard let shifted = utcCalendar.date(byAdding: .day, value: deltaDays, to: base) else {
            return isoDate
        }
        return isoFormatter.string(from: shifted)
    }

    /// Inclusive day span: same calendar returns 0; consecutive returns 1.
    public static func daysBetweenInclusive(fromIso: String, toIso: String) -> Int {
        guard let a = isoFormatter.date(from: fromIso), let b = isoFormatter.date(from: toIso) else { return 0 }
        let d = utcCalendar.dateComponents([.day], from: a, to: b).day ?? 0
        return d
    }

    private static let isoFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        df.calendar = cal
        return df
    }()

    /// Strict `YYYY-MM-DD` that parses as a real UTC calendar day and round-trips.
    public static func isValidSessionCalendarDate(_ value: String) -> Bool {
        guard value.count == 10,
              value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              let date = isoFormatter.date(from: value) else { return false }
        return isoFormatter.string(from: date) == value
    }

    public static func utcTodayIsoDate() -> String {
        isoFormatter.string(from: Date())
    }

    /// Matches backend `maxReasonDate()` — UTC today + 1 for users ahead of UTC (#441).
    public static func maxFailureReasonDate() -> String {
        addDays(toIsoDate: utcTodayIsoDate(), deltaDays: 1)
    }
}

// MARK: - Streak / aggregate stats (matches web `calculateSessionStats`)

public enum SessionStatistics {
    /// Aggregates standard sessions only — quick sits are intentionally excluded (#379).
    ///
    /// Streak and the per-session averages measure the progressive daily practice:
    /// quick sits never advance `currentDay` (see `StillPoint.shouldAdvanceDay`) and
    /// run a fixed 60s, so counting them would extend streaks without the daily sit
    /// and skew averages calibrated to the growing durations. This matches the web
    /// app's `calculateSessionStats`. Quick sits still appear in the history journey
    /// (`HistoryJourney.buildRows`).
    public static func calculateStats(for sessions: [SessionDTO]) -> StatsDTO {
        let standard = sessions.filter { $0.sessionType == .standard }
        guard !standard.isEmpty else {
            return StatsDTO(streak: 0, avgClearPercent: 0, avgThoughtsPerSession: 0, avgThoughtsPerMinute: 0)
        }

        let completedSessions = standard.filter(\.completed)
        let allHaveSessionDate = standard.allSatisfy { SessionCalendar.isValidSessionCalendarDate($0.sessionDate) }

        var streak = 0
        if allHaveSessionDate {
            var completedDates = Set<String>()
            for s in standard where s.completed {
                completedDates.insert(s.sessionDate)
            }
            let latestCal = standard.map(\.sessionDate).max() ?? ""
            let latestDayHasCompletion = standard.contains { $0.sessionDate == latestCal && $0.completed }
            if latestCal.isEmpty || !latestDayHasCompletion {
                streak = 0
            } else {
                var cursor = latestCal
                while completedDates.contains(cursor) {
                    streak += 1
                    let next = SessionCalendar.addDays(toIsoDate: cursor, deltaDays: -1)
                    if next == cursor { break }
                    cursor = next
                }
            }
        } else {
            var completedByDay: [Int: Bool] = [:]
            for s in standard {
                completedByDay[s.dayNumber] = (completedByDay[s.dayNumber] ?? false) || s.completed
            }
            let maxDay = completedByDay.keys.max() ?? 0
            for day in stride(from: maxDay, through: 1, by: -1) {
                if completedByDay[day] == true {
                    streak += 1
                } else {
                    break
                }
            }
        }

        let totalClear = completedSessions.reduce(0) { $0 + $1.clearPercent }
        let totalThoughts = standard.reduce(0) { $0 + $1.thoughtCount }
        let bonusSecondsTotal = completedSessions.reduce(0) { $0 + ($1.bonusSeconds ?? 0) }
        let bonusMinutesTotal = bonusSecondsTotal / 60
        let sumThoughtRates = standard.reduce(0.0) { sum, session in
            let minutes = Double(max(session.actualTime ?? session.duration, 1)) / 60.0
            return sum + (minutes > 0 ? Double(session.thoughtCount) / minutes : 0)
        }
        let avgClearPercent = completedSessions.isEmpty ? 0 : totalClear / completedSessions.count
        let avgThoughtsPerSession = Double(totalThoughts) / Double(standard.count)
        let avgThoughtsPerMinute = sumThoughtRates / Double(standard.count)
        return StatsDTO(
            streak: streak,
            avgClearPercent: avgClearPercent,
            avgThoughtsPerSession: avgThoughtsPerSession,
            avgThoughtsPerMinute: avgThoughtsPerMinute,
            bonusMinutesTotal: bonusMinutesTotal
        )
    }
}

// MARK: - History journey rows (all session types)

public enum HistoryJourneyListRow: Sendable {
    case missed(date: String)
    /// Collapsed run of `dayCount` consecutive missed days, `startDate`...`endDate` inclusive.
    case missedRange(startDate: String, endDate: String, dayCount: Int)
    case session(session: SessionDTO, sessionIndexInDay: Int)
}

public enum HistoryJourney {
    /// Gaps of this many consecutive missed days or more collapse into one `.missedRange`
    /// row; shorter gaps keep per-day `.missed` rows (#379). The web journey mirrors this
    /// exactly — same threshold and the matching `missedRange` row kind (#421). Shared
    /// golden fixtures (`shared/test-fixtures/historyJourney.json`) lock both in lockstep.
    public static let collapseGapThresholdDays = 3

    /// Builds journey rows from all sessions (standard and quick), sorted by
    /// `sessionDate` then `createdAt` / `id`.
    ///
    /// `sessionIndexInDay` counts per session type within a calendar day, so standard
    /// numbering is unaffected by interleaved quick sits. Pass `todayIsoDate` (caller's
    /// local calendar day, same convention used to stamp `sessionDate`) to also emit
    /// gap rows between the last session and today; today itself is never missed.
    public static func buildRows(fromSessions sessions: [SessionDTO], todayIsoDate: String? = nil) -> [HistoryJourneyListRow] {
        let sorted = sessions.sorted {
            if $0.sessionDate != $1.sessionDate { return $0.sessionDate < $1.sessionDate }
            let a = $0.createdAt ?? ""
            let b = $1.createdAt ?? ""
            if a != b { return a < b }
            return $0.id < $1.id
        }
        var rows: [HistoryJourneyListRow] = []
        var perDayTypeIndex: [String: Int] = [:]

        for i in sorted.indices {
            if i > 0 {
                appendGapRows(after: sorted[i - 1].sessionDate, before: sorted[i].sessionDate, into: &rows)
            }
            let cur = sorted[i]
            let key = "\(cur.sessionDate)|\(cur.sessionType.rawValue)"
            let n = (perDayTypeIndex[key] ?? 0) + 1
            perDayTypeIndex[key] = n
            rows.append(.session(session: cur, sessionIndexInDay: n))
        }

        if let todayIsoDate, let last = sorted.last {
            appendGapRows(after: last.sessionDate, before: todayIsoDate, into: &rows)
        }
        return rows
    }

    /// Emits rows for the missed days strictly between `fromIso` and `toIso`: per-day
    /// `.missed` rows for short gaps, a single `.missedRange` at the collapse threshold.
    private static func appendGapRows(after fromIso: String, before toIso: String, into rows: inout [HistoryJourneyListRow]) {
        let daysBetween = SessionCalendar.daysBetweenInclusive(fromIso: fromIso, toIso: toIso)
        let missedCount = max(0, daysBetween - 1)
        guard missedCount > 0 else { return }
        if missedCount >= collapseGapThresholdDays {
            rows.append(.missedRange(
                startDate: SessionCalendar.addDays(toIsoDate: fromIso, deltaDays: 1),
                endDate: SessionCalendar.addDays(toIsoDate: fromIso, deltaDays: missedCount),
                dayCount: missedCount
            ))
        } else {
            for gap in 1...missedCount {
                rows.append(.missed(date: SessionCalendar.addDays(toIsoDate: fromIso, deltaDays: gap)))
            }
        }
    }
}
