import XCTest
import StillPointShared

final class HistoryMindStateTrendsTests: XCTestCase {
    private func makeSession(
        date: String,
        duration: Int,
        log: [MindStateEntry]
    ) -> SessionDTO {
        SessionDTO(
            id: UUID().uuidString,
            dayNumber: 1,
            sessionType: .standard,
            duration: duration,
            completed: true,
            actualTime: duration,
            clearPercent: 50,
            thoughtCount: 0,
            mindStateLog: log,
            sessionDate: date,
            createdAt: nil,
            buddySessionId: nil
        )
    }

    func testComputeCompositionFromLogEmpty() {
        let composition = MindStateSession.computeCompositionFromLog([], endTime: 300)
        XCTAssertEqual(composition.clearSeconds, 300)
        XCTAssertEqual(composition.totalSeconds, 300)
    }

    func testComputeCompositionFromLogSplitsSegments() {
        let composition = MindStateSession.computeCompositionFromLog([
            MindStateEntry(time: 0, state: "clear"),
            MindStateEntry(time: 60, state: "thinking"),
            MindStateEntry(time: 120, state: "clear"),
            MindStateEntry(time: 180, state: "hyperfocus"),
            MindStateEntry(time: 240, state: "heavy"),
            MindStateEntry(time: 300, state: "clear"),
        ], endTime: 300)

        XCTAssertEqual(composition.clearSeconds, 120)
        XCTAssertEqual(composition.lightDistractionSeconds, 60)
        XCTAssertEqual(composition.heavyDistractionSeconds, 60)
        XCTAssertEqual(composition.hyperfocusSeconds, 60)
        XCTAssertEqual(composition.totalSeconds, 300)
    }

    func testCalculateTrendStatsAggregatesTrailingWindow() {
        let stats = HistoryMindStateTrends.calculateTrendStats(
            sessions: [
                makeSession(
                    date: "2026-07-01",
                    duration: 180,
                    log: [
                        MindStateEntry(time: 0, state: "clear"),
                        MindStateEntry(time: 60, state: "thinking"),
                        MindStateEntry(time: 120, state: "hyperfocus"),
                        MindStateEntry(time: 180, state: "clear"),
                    ]
                ),
            ],
            todayIso: "2026-07-02"
        )

        XCTAssertEqual(stats.trailing4Week.totalSitSeconds, 180)
        XCTAssertEqual(stats.trailing4Week.lightDistractionPercent, 33.3, accuracy: 0.1)
        XCTAssertEqual(stats.trailing4Week.hyperfocusPercent, 33.3, accuracy: 0.1)
        XCTAssertEqual(stats.trailing4Week.heavyDistractionPercent, 0)
        XCTAssertEqual(stats.dailyTrend.count, 28)
    }

    /// #839: a focus session logs no mind state, so its empty log would otherwise read as
    /// up to two hours of clear time and swamp the sit averages. Skipped, as on web (#836).
    func testCalculateTrendStatsSkipsFocusSessions() {
        let sit = makeSession(
            date: "2026-07-01",
            duration: 120,
            log: [
                MindStateEntry(time: 0, state: "clear"),
                MindStateEntry(time: 60, state: "thinking"),
                MindStateEntry(time: 120, state: "clear"),
            ]
        )
        let focus = SessionDTO(
            id: "focus-1",
            dayNumber: 3,
            sessionType: .focus,
            duration: 7200,
            completed: true,
            actualTime: 7200,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-07-01",
            createdAt: nil,
            buddySessionId: nil,
            focusCategory: .reading
        )

        let stats = HistoryMindStateTrends.calculateTrendStats(sessions: [sit, focus], todayIso: "2026-07-02")

        XCTAssertEqual(stats.trailing4Week.totalSitSeconds, 120)
        XCTAssertEqual(stats.trailing4Week.clearPercent, 50)
        XCTAssertEqual(stats.trailing4Week.lightDistractionPercent, 50)
        XCTAssertEqual(stats.allTime.totalSitSeconds, 120)
        XCTAssertEqual(stats.dailyTrend.first { $0.date == "2026-07-01" }?.totalSitSeconds, 120)

        let focusOnly = HistoryMindStateTrends.calculateTrendStats(sessions: [focus], todayIso: "2026-07-02")
        XCTAssertEqual(focusOnly.allTime, .empty)
        XCTAssertEqual(focusOnly.trailing4Week, .empty)
    }
}
