import Foundation
import Testing
import StillPointShared

struct HistoryMonthGridTests {
    private func makeSession(
        date: String,
        duration: Int,
        actualTime: Int? = nil,
        sessionType: SessionType = .standard,
        createdAt: String? = nil,
        id: String = UUID().uuidString
    ) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: 1,
            sessionType: sessionType,
            duration: duration,
            completed: true,
            actualTime: actualTime ?? duration,
            clearPercent: 50,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: date,
            createdAt: createdAt,
            buddySessionId: nil
        )
    }

    @Test func testFormatSessionDurationLabel() {
        #expect(HistoryMonthGrid.formatSessionDurationLabel(45) == "45s")
        #expect(HistoryMonthGrid.formatSessionDurationLabel(480) == "8m")
    }

    @Test func testBuildCurrentMonthGridMarksMeditatedAndFutureDays() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [
                makeSession(date: "2026-07-01", duration: 480),
                makeSession(date: "2026-07-02", duration: 60, sessionType: .quick),
            ],
            todayIso: "2026-07-02"
        )

        #expect(grid.yearMonth == "2026-07")
        let dayCells = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }
        let jul1 = dayCells.first { $0.isoDate == "2026-07-01" }!
        let jul2 = dayCells.first { $0.isoDate == "2026-07-02" }!
        let jul3 = dayCells.first { $0.isoDate == "2026-07-03" }!

        #expect(jul1.state == .meditated)
        #expect(jul1.durationLabels == ["8m"])
        #expect(jul2.state == .meditated)
        #expect(jul3.state == .future)
    }

    @Test func testBuildCurrentMonthGridShowsTodayWithoutSession() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [makeSession(date: "2026-07-01", duration: 60)],
            todayIso: "2026-07-02"
        )
        let today = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }.first { $0.isoDate == "2026-07-02" }!
        #expect(today.state == .today)
    }

    /// #839: a focus session marks its day as any session does, quick and breath
    /// included, with its own time label.
    @Test func testFocusSessionMarksItsDayMeditated() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [makeSession(date: "2026-10-20", duration: 1800, sessionType: .focus)],
            todayIso: "2026-10-27"
        )
        let dayCells = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }
        let focusDay = dayCells.first { $0.isoDate == "2026-10-20" }!
        let emptyDay = dayCells.first { $0.isoDate == "2026-10-21" }!

        #expect(focusDay.state == .meditated)
        #expect(focusDay.durationLabels == ["30m"])
        #expect(emptyDay.state == .missed)
    }

    @Test func testMultipleSessionsOnOneDay() {
        let grid = HistoryMonthGrid.buildCurrentMonthGrid(
            sessions: [
                makeSession(date: "2026-07-01", duration: 480, createdAt: "2026-07-01T10:00:00Z"),
                makeSession(date: "2026-07-01", duration: 60, createdAt: "2026-07-01T11:00:00Z"),
            ],
            todayIso: "2026-07-02"
        )
        let jul1 = grid.cells.compactMap { cell -> MonthGridDay? in
            if case .day(let day) = cell { return day }
            return nil
        }.first { $0.isoDate == "2026-07-01" }!
        #expect(jul1.durationLabels == ["8m", "1m"])
    }

    @Test func testBuildPriorMonthSummaries() {
        let summaries = HistoryMonthGrid.buildPriorMonthSummaries(
            sessions: [
                makeSession(date: "2026-05-10", duration: 600),
                makeSession(date: "2026-05-20", duration: 300),
                makeSession(date: "2026-06-15", duration: 120),
                makeSession(date: "2026-07-01", duration: 60),
            ],
            todayIso: "2026-07-02"
        )

        #expect(summaries.map(\.yearMonth) == ["2026-05", "2026-06"])
        #expect(summaries[0].daysActive == 2)
        #expect(summaries[0].daysInMonth == 31)
        #expect(summaries[0].totalTimeSeconds == 900)
        #expect(summaries[1].daysActive == 1)
        #expect(summaries[1].daysInMonth == 30)
        #expect(summaries[1].totalTimeSeconds == 120)
    }

    @Test func testBuildPriorMonthSummariesEmptyForCurrentMonthOnly() {
        let summaries = HistoryMonthGrid.buildPriorMonthSummaries(
            sessions: [makeSession(date: "2026-07-01", duration: 60)],
            todayIso: "2026-07-02"
        )
        #expect(summaries.isEmpty)
    }

    @Test func testFormatTotalTime() {
        #expect(HistoryMonthGrid.formatTotalTime(8100) == "2h 15m")
        #expect(HistoryMonthGrid.formatTotalTime(3600) == "1h")
        #expect(HistoryMonthGrid.formatTotalTime(90) == "2m")
    }

    @Test func testBuildTrailing12MonthSummaries() {
        let summaries = HistoryMonthlyAggregation.buildTrailing12MonthSummaries(
            sessions: [makeSession(date: "2026-06-15", duration: 120)],
            todayIso: "2026-07-02"
        )
        #expect(summaries.count == 12)
        #expect(summaries.last?.yearMonth == "2026-07")
        #expect(summaries.first?.yearMonth == "2025-08")
    }
}
