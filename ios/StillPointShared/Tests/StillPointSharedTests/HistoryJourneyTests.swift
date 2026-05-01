import XCTest
import StillPointShared

final class HistoryJourneyTests: XCTestCase {
    func testSequentialSessionLabelsSameDay() {
        let rows = HistoryJourney.buildRows(fromStandardSessions: [
            SessionDTO(
                id: "a",
                dayNumber: 1,
                sessionType: .standard,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-04-28",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "b",
                dayNumber: 1,
                sessionType: .standard,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-04-28",
                buddySessionId: nil
            ),
        ])
        guard case .standardSession(_, let n1) = rows[0],
              case .standardSession(_, let n2) = rows[1] else {
            return XCTFail("expected two session rows")
        }
        XCTAssertEqual(n1, 1)
        XCTAssertEqual(n2, 2)
    }

    func testSameDaySessionsOrderedByCreatedAt() {
        let rows = HistoryJourney.buildRows(fromStandardSessions: [
            SessionDTO(
                id: "later-id",
                dayNumber: 1,
                sessionType: .standard,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-04-28",
                createdAt: "2026-04-28T12:00:00.000Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "earlier-id",
                dayNumber: 1,
                sessionType: .standard,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-04-28",
                createdAt: "2026-04-28T10:00:00.000Z",
                buddySessionId: nil
            ),
        ])
        guard case .standardSession(let first, let n1) = rows[0],
              case .standardSession(let second, let n2) = rows[1] else {
            return XCTFail("expected two session rows")
        }
        XCTAssertEqual(first.id, "earlier-id")
        XCTAssertEqual(second.id, "later-id")
        XCTAssertEqual(n1, 1)
        XCTAssertEqual(n2, 2)
    }

    func testStreakCountsUniqueCalendarDays() {
        let stats = SessionStatistics.calculateStats(for: [
            SessionDTO(
                id: "1",
                dayNumber: 1,
                sessionType: .standard,
                duration: 60,
                completed: true,
                actualTime: 60,
                clearPercent: 80,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-04-28",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "2",
                dayNumber: 2,
                sessionType: .standard,
                duration: 70,
                completed: true,
                actualTime: 70,
                clearPercent: 90,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-04-28",
                buddySessionId: nil
            ),
        ])
        XCTAssertEqual(stats.streak, 1)
    }
}
