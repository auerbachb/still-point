import XCTest
import StillPointShared

final class HistoryMonthGridTests: XCTestCase {
    private func makeSession(
        date: String,
        duration: Int,
        actualTime: Int? = nil,
        sessionType: SessionType = .standard
    ) -> SessionDTO {
        SessionDTO(
            id: UUID().uuidString,
            dayNumber: 1,
            sessionType: sessionType,
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

    func testFormatSessionDurationLabel() {
        XCTAssertEqual(HistoryMonthGrid.formatSessionDurationLabel(45), "45s")
        XCTAssertEqual(HistoryMonthGrid.formatSessionDurationLabel(480), "8m")
    }

    func testBuildCurrentMonthGridMarksMeditatedAndFutureDays() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [
                makeSession(date: "2026-07-01", duration: 480),
                makeSession(date: "2026-07-02", duration: 60, sessionType: .quick),
            ],
            todayIso: "2026-07-02"
        )

        XCTAssertEqual(grid.yearMonth, "2026-07")
        let dayCells = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }
        let jul1 = dayCells.first { $0.isoDate == "2026-07-01" }!
        let jul2 = dayCells.first { $0.isoDate == "2026-07-02" }!
        let jul3 = dayCells.first { $0.isoDate == "2026-07-03" }!

        XCTAssertEqual(jul1.state, .meditated)
        XCTAssertEqual(jul1.durationLabels, ["8m"])
        XCTAssertEqual(jul2.state, .meditated)
        XCTAssertEqual(jul3.state, .future)
    }

    func testBuildCurrentMonthGridShowsTodayWithoutSession() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [makeSession(date: "2026-07-01", duration: 60)],
            todayIso: "2026-07-02"
        )
        let today = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }.first { $0.isoDate == "2026-07-02" }!
        XCTAssertEqual(today.state, .today)
    }

    func testMultipleSessionsOnOneDay() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [
                makeSession(date: "2026-07-01", duration: 480),
                makeSession(date: "2026-07-01", duration: 60),
            ],
            todayIso: "2026-07-02"
        )
        let jul1 = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }.first { $0.isoDate == "2026-07-01" }!
        XCTAssertEqual(jul1.durationLabels, ["8m", "1m"])
    }

    func testBuildPriorMonthSummaries() {
        let summaries = HistoryMonthGrid.buildPriorMonthSummaries(
            sessions: [
                makeSession(date: "2026-05-10", duration: 600),
                makeSession(date: "2026-05-20", duration: 300),
                makeSession(date: "2026-06-15", duration: 120),
                makeSession(date: "2026-07-01", duration: 60),
            ],
            todayIso: "2026-07-02"
        )

        XCTAssertEqual(summaries.map(\.yearMonth), ["2026-05", "2026-06"])
        XCTAssertEqual(summaries[0].daysActive, 2)
        XCTAssertEqual(summaries[0].daysInMonth, 31)
        XCTAssertEqual(summaries[0].totalTimeSeconds, 900)
        XCTAssertEqual(summaries[1].daysActive, 1)
        XCTAssertEqual(summaries[1].daysInMonth, 30)
        XCTAssertEqual(summaries[1].totalTimeSeconds, 120)
    }

    func testBuildPriorMonthSummariesEmptyForCurrentMonthOnly() {
        let summaries = HistoryMonthGrid.buildPriorMonthSummaries(
            sessions: [makeSession(date: "2026-07-01", duration: 60)],
            todayIso: "2026-07-02"
        )
        XCTAssertTrue(summaries.isEmpty)
    }

    func testFormatTotalTime() {
        XCTAssertEqual(HistoryMonthGrid.formatTotalTime(8100), "2h 15m")
        XCTAssertEqual(HistoryMonthGrid.formatTotalTime(3600), "1h")
        XCTAssertEqual(HistoryMonthGrid.formatTotalTime(90), "2m")
    }

    func testBuildTrailing12MonthSummaries() {
        let summaries = HistoryMonthlyAggregation.buildTrailing12MonthSummaries(
            sessions: [makeSession(date: "2026-06-15", duration: 120)],
            todayIso: "2026-07-02"
        )
        XCTAssertEqual(summaries.count, 12)
        XCTAssertEqual(summaries.last?.yearMonth, "2026-07")
        XCTAssertEqual(summaries.first?.yearMonth, "2025-08")
    }
}
