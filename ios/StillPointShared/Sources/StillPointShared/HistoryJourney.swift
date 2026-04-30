import Foundation

// MARK: - Calendar helpers (UTC date parts; matches `session_date` strings)

public enum SessionCalendar {
    public static func addDays(toIsoDate isoDate: String, deltaDays: Int) -> String {
        let parts = isoDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return isoDate }
        var c = DateComponents()
        c.year = parts[0]
        c.month = parts[1]
        c.day = parts[2]
        c.calendar = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(secondsFromGMT: 0)
        guard let base = c.date else { return isoDate }
        guard let shifted = Calendar(identifier: .gregorian).date(byAdding: .day, value: deltaDays, to: base) else {
            return isoDate
        }
        let df = isoFormatter
        return df.string(from: shifted)
    }

    /// Inclusive day span: same calendar returns 0; consecutive returns 1.
    public static func daysBetweenInclusive(fromIso: String, toIso: String) -> Int {
        guard let a = isoFormatter.date(from: fromIso), let b = isoFormatter.date(from: toIso) else { return 0 }
        let cal = Calendar(identifier: .gregorian)
        let d = cal.dateComponents([.day], from: a, to: b).day ?? 0
        return d
    }

    private static let isoFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        df.calendar = Calendar(identifier: .gregorian)
        return df
    }()
}

// MARK: - Streak / aggregate stats (matches web `calculateSessionStats`)

public enum SessionStatistics {
    public static func calculateStats(for sessions: [SessionDTO]) -> StatsDTO {
        let standard = sessions.filter { $0.sessionType == .standard }
        guard !standard.isEmpty else {
            return StatsDTO(streak: 0, avgClearPercent: 0, avgThoughtsPerSession: 0, avgThoughtsPerMinute: 0)
        }

        let completedSessions = standard.filter(\.completed)
        let allHaveSessionDate = standard.allSatisfy { !$0.sessionDate.isEmpty }

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
                    cursor = SessionCalendar.addDays(toIsoDate: cursor, deltaDays: -1)
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
        let totalMinutes = standard.reduce(0.0) { partial, session in
            let duration = Double(max(session.actualTime ?? session.duration, 1))
            return partial + (duration / 60.0)
        }
        let avgClearPercent = completedSessions.isEmpty ? 0 : totalClear / completedSessions.count
        let avgThoughtsPerSession = Double(totalThoughts) / Double(standard.count)
        let avgThoughtsPerMinute = totalMinutes > 0 ? Double(totalThoughts) / totalMinutes : 0
        return StatsDTO(
            streak: streak,
            avgClearPercent: avgClearPercent,
            avgThoughtsPerSession: avgThoughtsPerSession,
            avgThoughtsPerMinute: avgThoughtsPerMinute
        )
    }
}

// MARK: - History journey rows (standard sessions; quick excluded by caller)

public enum HistoryJourneyListRow: Equatable, Sendable {
    case missed(date: String)
    case standardSession(session: SessionDTO, sessionIndexInDay: Int)
}

public enum HistoryJourney {
    /// `sessions` should be standard-only; sorted by `sessionDate` then stable id.
    public static func buildRows(fromStandardSessions sessions: [SessionDTO]) -> [HistoryJourneyListRow] {
        let sorted = sessions.sorted {
            if $0.sessionDate != $1.sessionDate { return $0.sessionDate < $1.sessionDate }
            return $0.id < $1.id
        }
        var rows: [HistoryJourneyListRow] = []
        var perDayIndex: [String: Int] = [:]

        for i in sorted.indices {
            if i > 0 {
                let prev = sorted[i - 1]
                let daysBetween = SessionCalendar.daysBetweenInclusive(fromIso: prev.sessionDate, toIso: sorted[i].sessionDate)
                for gap in 1..<daysBetween {
                    let missedDate = SessionCalendar.addDays(toIsoDate: prev.sessionDate, deltaDays: gap)
                    rows.append(.missed(date: missedDate))
                }
            }
            let cur = sorted[i]
            let n = (perDayIndex[cur.sessionDate] ?? 0) + 1
            perDayIndex[cur.sessionDate] = n
            rows.append(.standardSession(session: cur, sessionIndexInDay: n))
        }
        return rows
    }
}
