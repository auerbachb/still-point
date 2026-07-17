import Foundation

public enum HistoryStats {
    public static let trailing4WeekDays = 28
    private static let secondsIn4Weeks = trailing4WeekDays * 24 * 60 * 60
    private static let tenThousandHoursSeconds = 10_000 * 60 * 60

    public struct PeriodStats: Sendable, Equatable {
        public let trailing4WeekDays: Int
        public let trailing4WeekDayPercent: Double
        public let trailing4WeekTotalTime: Int
        public let trailing4WeekTimePercent: Double
        public let totalTimeAllTime: Int
        public let progressTo10kHours: Double

        public init(
            trailing4WeekDays: Int,
            trailing4WeekDayPercent: Double,
            trailing4WeekTotalTime: Int,
            trailing4WeekTimePercent: Double,
            totalTimeAllTime: Int,
            progressTo10kHours: Double
        ) {
            self.trailing4WeekDays = trailing4WeekDays
            self.trailing4WeekDayPercent = trailing4WeekDayPercent
            self.trailing4WeekTotalTime = trailing4WeekTotalTime
            self.trailing4WeekTimePercent = trailing4WeekTimePercent
            self.totalTimeAllTime = totalTimeAllTime
            self.progressTo10kHours = progressTo10kHours
        }
    }

    /// Trailing 4-week and all-time stats for the History view (#83).
    /// `todayIso` should match the client's local calendar day (same convention as
    /// `sessionDate` stamping) so the window ends on the user's "today".
    public static func calculatePeriodStats(
        sessions: [some HistorySessionTimeInput],
        todayIso: String
    ) -> PeriodStats {
        let periodStart = SessionCalendar.addDays(toIsoDate: todayIso, deltaDays: -(trailing4WeekDays - 1))
        var datesInPeriod = Set<String>()
        var trailing4WeekTotalTime = 0
        var totalTimeAllTime = 0

        for session in sessions {
            guard SessionCalendar.isValidSessionCalendarDate(session.sessionDate) else { continue }
            let secs = HistorySessionTime.sessionTimeSeconds(session)
            totalTimeAllTime += secs
            if session.sessionDate >= periodStart && session.sessionDate <= todayIso {
                datesInPeriod.insert(session.sessionDate)
                trailing4WeekTotalTime += secs
            }
        }

        let trailing4WeekDayCount = datesInPeriod.count
        let trailing4WeekDayPercent = roundToOneDecimal(
            (Double(trailing4WeekDayCount) / Double(trailing4WeekDays)) * 100
        )
        let trailing4WeekTimePercent = roundToTwoDecimals(
            (Double(trailing4WeekTotalTime) / Double(secondsIn4Weeks)) * 100
        )
        let progressTo10kHours = roundToTwoDecimals(
            (Double(totalTimeAllTime) / Double(tenThousandHoursSeconds)) * 100
        )

        return PeriodStats(
            trailing4WeekDays: trailing4WeekDayCount,
            trailing4WeekDayPercent: trailing4WeekDayPercent,
            trailing4WeekTotalTime: trailing4WeekTotalTime,
            trailing4WeekTimePercent: trailing4WeekTimePercent,
            totalTimeAllTime: totalTimeAllTime,
            progressTo10kHours: progressTo10kHours
        )
    }

    private static func roundToOneDecimal(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }

    private static func roundToTwoDecimals(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }
}
