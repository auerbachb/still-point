import Foundation

public struct MindStateCompositionPercents: Codable, Sendable, Equatable {
    public let clearPercent: Double
    public let lightDistractionPercent: Double
    public let heavyDistractionPercent: Double
    public let hyperfocusPercent: Double

    public init(
        clearPercent: Double,
        lightDistractionPercent: Double,
        heavyDistractionPercent: Double,
        hyperfocusPercent: Double
    ) {
        self.clearPercent = clearPercent
        self.lightDistractionPercent = lightDistractionPercent
        self.heavyDistractionPercent = heavyDistractionPercent
        self.hyperfocusPercent = hyperfocusPercent
    }

    public static let empty = MindStateCompositionPercents(
        clearPercent: 0,
        lightDistractionPercent: 0,
        heavyDistractionPercent: 0,
        hyperfocusPercent: 0
    )
}

public struct MindStateDailyTrendBucket: Codable, Sendable, Equatable {
    public let date: String
    public let totalSitSeconds: Int
    public let composition: MindStateCompositionPercents

    public init(date: String, totalSitSeconds: Int, composition: MindStateCompositionPercents) {
        self.date = date
        self.totalSitSeconds = totalSitSeconds
        self.composition = composition
    }
}

public struct MindStateTrendPeriodStats: Codable, Sendable, Equatable {
    public let totalSitSeconds: Int
    public let clearPercent: Double
    public let lightDistractionPercent: Double
    public let heavyDistractionPercent: Double
    public let hyperfocusPercent: Double

    public init(
        totalSitSeconds: Int,
        clearPercent: Double,
        lightDistractionPercent: Double,
        heavyDistractionPercent: Double,
        hyperfocusPercent: Double
    ) {
        self.totalSitSeconds = totalSitSeconds
        self.clearPercent = clearPercent
        self.lightDistractionPercent = lightDistractionPercent
        self.heavyDistractionPercent = heavyDistractionPercent
        self.hyperfocusPercent = hyperfocusPercent
    }

    public static let empty = MindStateTrendPeriodStats(
        totalSitSeconds: 0,
        clearPercent: 0,
        lightDistractionPercent: 0,
        heavyDistractionPercent: 0,
        hyperfocusPercent: 0
    )
}

public struct MindStateTrendStats: Codable, Sendable, Equatable {
    public let trailing4Week: MindStateTrendPeriodStats
    public let allTime: MindStateTrendPeriodStats
    public let dailyTrend: [MindStateDailyTrendBucket]

    public init(
        trailing4Week: MindStateTrendPeriodStats,
        allTime: MindStateTrendPeriodStats,
        dailyTrend: [MindStateDailyTrendBucket]
    ) {
        self.trailing4Week = trailing4Week
        self.allTime = allTime
        self.dailyTrend = dailyTrend
    }

    public static let empty = MindStateTrendStats(
        trailing4Week: .empty,
        allTime: .empty,
        dailyTrend: []
    )
}

public protocol MindStateTrendSessionInput: HistorySessionTimeInput {
    var mindStateLog: [MindStateEntry]? { get }
    var duration: Int { get }
}

extension SessionDTO: MindStateTrendSessionInput {}

public enum HistoryMindStateTrends {
    private static func emptyComposition() -> MindStateCompositionSeconds {
        MindStateCompositionSeconds()
    }

    private static func addComposition(
        _ target: inout MindStateCompositionSeconds,
        _ next: MindStateCompositionSeconds
    ) {
        target.clearSeconds += next.clearSeconds
        target.lightDistractionSeconds += next.lightDistractionSeconds
        target.heavyDistractionSeconds += next.heavyDistractionSeconds
        target.hyperfocusSeconds += next.hyperfocusSeconds
        target.totalSeconds += next.totalSeconds
    }

    private static func compositionPercents(_ composition: MindStateCompositionSeconds) -> MindStateCompositionPercents {
        let denom = max(composition.totalSeconds, 1)
        func toPercent(_ seconds: Int) -> Double {
            (Double(seconds) / Double(denom) * 100 * 10).rounded() / 10
        }
        return MindStateCompositionPercents(
            clearPercent: toPercent(composition.clearSeconds),
            lightDistractionPercent: toPercent(composition.lightDistractionSeconds),
            heavyDistractionPercent: toPercent(composition.heavyDistractionSeconds),
            hyperfocusPercent: toPercent(composition.hyperfocusSeconds)
        )
    }

    /// Session-elapsed seconds for trend replay (same axis as clear-percent endT, not wall-clock actualTime).
    private static func sessionEndTime(_ session: some MindStateTrendSessionInput) -> Int {
        let elapsedCap = max(HistorySessionTime.sessionTimeSeconds(session), 0)
        let log = session.mindStateLog ?? []
        var elapsedEnd = 0
        for entry in log {
            guard entry.time.isFinite else { continue }
            elapsedEnd = max(elapsedEnd, max(Int(entry.time.rounded(.down)), 0))
        }
        if elapsedEnd > 0 { return min(elapsedEnd, elapsedCap) }
        return elapsedCap
    }

    private static func compositionForSession(_ session: some MindStateTrendSessionInput) -> MindStateCompositionSeconds {
        let endTime = sessionEndTime(session)
        return MindStateSession.computeCompositionFromLog(session.mindStateLog ?? [], endTime: endTime)
    }

    /// Aggregates sit-time composition from persisted `mindStateLog` rows for History trends (#182).
    public static func calculateTrendStats(
        sessions: [some MindStateTrendSessionInput],
        todayIso: String
    ) -> MindStateTrendStats {
        let periodStart = SessionCalendar.addDays(
            toIsoDate: todayIso,
            deltaDays: -(HistoryStats.trailing4WeekDays - 1)
        )
        var trailingTotals = emptyComposition()
        var allTimeTotals = emptyComposition()
        var dailyTotals: [String: MindStateCompositionSeconds] = [:]

        for offset in 0..<HistoryStats.trailing4WeekDays {
            let date = SessionCalendar.addDays(toIsoDate: periodStart, deltaDays: offset)
            dailyTotals[date] = emptyComposition()
        }

        for session in sessions {
            guard SessionCalendar.isValidSessionCalendarDate(session.sessionDate) else { continue }
            let composition = compositionForSession(session)
            guard composition.totalSeconds > 0 else { continue }

            addComposition(&allTimeTotals, composition)

            if session.sessionDate >= periodStart && session.sessionDate <= todayIso {
                addComposition(&trailingTotals, composition)
                if var dayBucket = dailyTotals[session.sessionDate] {
                    addComposition(&dayBucket, composition)
                    dailyTotals[session.sessionDate] = dayBucket
                }
            }
        }

        var dailyTrend: [MindStateDailyTrendBucket] = []
        for offset in 0..<HistoryStats.trailing4WeekDays {
            let date = SessionCalendar.addDays(toIsoDate: periodStart, deltaDays: offset)
            let totals = dailyTotals[date] ?? emptyComposition()
            dailyTrend.append(MindStateDailyTrendBucket(
                date: date,
                totalSitSeconds: totals.totalSeconds,
                composition: compositionPercents(totals)
            ))
        }

        let trailingPercents = compositionPercents(trailingTotals)
        let allTimePercents = compositionPercents(allTimeTotals)

        return MindStateTrendStats(
            trailing4Week: MindStateTrendPeriodStats(
                totalSitSeconds: trailingTotals.totalSeconds,
                clearPercent: trailingPercents.clearPercent,
                lightDistractionPercent: trailingPercents.lightDistractionPercent,
                heavyDistractionPercent: trailingPercents.heavyDistractionPercent,
                hyperfocusPercent: trailingPercents.hyperfocusPercent
            ),
            allTime: MindStateTrendPeriodStats(
                totalSitSeconds: allTimeTotals.totalSeconds,
                clearPercent: allTimePercents.clearPercent,
                lightDistractionPercent: allTimePercents.lightDistractionPercent,
                heavyDistractionPercent: allTimePercents.heavyDistractionPercent,
                hyperfocusPercent: allTimePercents.hyperfocusPercent
            ),
            dailyTrend: dailyTrend
        )
    }
}
