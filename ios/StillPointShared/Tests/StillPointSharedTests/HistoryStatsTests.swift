import XCTest
import StillPointShared

final class HistoryStatsTests: XCTestCase {
    private func makeSession(date: String, duration: Int, actualTime: Int? = nil) -> SessionDTO {
        SessionDTO(
            id: UUID().uuidString,
            dayNumber: 1,
            sessionType: .standard,
            duration: duration,
            completed: true,
            actualTime: actualTime ?? duration,
            clearPercent: 50,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: date,
            createdAt: nil,
            buddySessionId: nil
        )
    }

    func testCalculatePeriodStats() {
        let stats = HistoryStats.calculatePeriodStats(
            sessions: [
                makeSession(date: "2026-06-20", duration: 120),
                makeSession(date: "2026-07-01", duration: 60, actualTime: 90),
            ],
            todayIso: "2026-07-02"
        )

        XCTAssertEqual(stats.trailing4WeekDays, 2)
        XCTAssertEqual(stats.trailing4WeekTotalTime, 210)
        XCTAssertEqual(stats.trailing4WeekDayPercent, 7.1, accuracy: 0.05)
        XCTAssertEqual(stats.trailing4WeekTimePercent, 0.01, accuracy: 0.01)
        XCTAssertEqual(stats.totalTimeAllTime, 210)
    }

    func testCalculatePeriodStatsEmptySessions() {
        let stats = HistoryStats.calculatePeriodStats(sessions: [], todayIso: "2026-07-02")
        XCTAssertEqual(stats.trailing4WeekDays, 0)
        XCTAssertEqual(stats.totalTimeAllTime, 0)
    }
}
