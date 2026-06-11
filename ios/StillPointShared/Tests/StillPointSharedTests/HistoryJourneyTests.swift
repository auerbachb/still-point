import XCTest
import StillPointShared

final class HistoryJourneyTests: XCTestCase {
    private func makeSession(
        id: String,
        type: SessionType = .standard,
        date: String,
        createdAt: String? = nil,
        completed: Bool = true,
        thoughtCount: Int = 0
    ) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: 1,
            sessionType: type,
            duration: 60,
            completed: completed,
            actualTime: 60,
            clearPercent: 50,
            thoughtCount: thoughtCount,
            mindStateLog: nil,
            sessionDate: date,
            createdAt: createdAt,
            buddySessionId: nil
        )
    }

    // MARK: - Session ordering / per-day indices

    func testSequentialSessionLabelsSameDay() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-04-28"),
            makeSession(id: "b", date: "2026-04-28"),
        ])
        guard case .session(_, let n1) = rows[0],
              case .session(_, let n2) = rows[1] else {
            return XCTFail("expected two session rows")
        }
        XCTAssertEqual(n1, 1)
        XCTAssertEqual(n2, 2)
    }

    func testSameDaySessionsOrderedByCreatedAt() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "later-id", date: "2026-04-28", createdAt: "2026-04-28T12:00:00.000Z"),
            makeSession(id: "earlier-id", date: "2026-04-28", createdAt: "2026-04-28T10:00:00.000Z"),
        ])
        guard case .session(let first, let n1) = rows[0],
              case .session(let second, let n2) = rows[1] else {
            return XCTFail("expected two session rows")
        }
        XCTAssertEqual(first.id, "earlier-id")
        XCTAssertEqual(second.id, "later-id")
        XCTAssertEqual(n1, 1)
        XCTAssertEqual(n2, 2)
    }

    // MARK: - Quick sessions in the journey (#379)

    func testQuickOnlySessionsProduceRows() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "q1", type: .quick, date: "2026-06-10"),
        ])
        XCTAssertEqual(rows.count, 1)
        guard case .session(let session, let n) = rows[0] else {
            return XCTFail("expected a session row for a quick sit")
        }
        XCTAssertEqual(session.sessionType, .quick)
        XCTAssertEqual(n, 1)
    }

    func testQuickAndStandardMixUsesPerTypeIndices() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "s1", date: "2026-06-10", createdAt: "2026-06-10T08:00:00.000Z"),
            makeSession(id: "q1", type: .quick, date: "2026-06-10", createdAt: "2026-06-10T09:00:00.000Z"),
            makeSession(id: "s2", date: "2026-06-10", createdAt: "2026-06-10T10:00:00.000Z"),
        ])
        XCTAssertEqual(rows.count, 3)
        guard case .session(let first, let n1) = rows[0],
              case .session(let second, let n2) = rows[1],
              case .session(let third, let n3) = rows[2] else {
            return XCTFail("expected three session rows")
        }
        // Chronological interleaving preserved...
        XCTAssertEqual(first.id, "s1")
        XCTAssertEqual(second.id, "q1")
        XCTAssertEqual(third.id, "s2")
        // ...while standard numbering ignores the quick sit in between.
        XCTAssertEqual(n1, 1)
        XCTAssertEqual(n2, 1)
        XCTAssertEqual(n3, 2)
    }

    // MARK: - Gap collapsing (#379)

    func testShortGapEmitsPerDayMissedRows() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-06-01"),
            makeSession(id: "b", date: "2026-06-04"),
        ])
        XCTAssertEqual(rows.count, 4)
        guard case .missed(let d1) = rows[1], case .missed(let d2) = rows[2] else {
            return XCTFail("expected two per-day missed rows for a 2-day gap")
        }
        XCTAssertEqual(d1, "2026-06-02")
        XCTAssertEqual(d2, "2026-06-03")
    }

    func testThreeMissedDaysCollapseToRange() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-06-01"),
            makeSession(id: "b", date: "2026-06-05"),
        ])
        XCTAssertEqual(rows.count, 3)
        guard case .missedRange(let start, let end, let count) = rows[1] else {
            return XCTFail("expected a collapsed missed range at the 3-day threshold")
        }
        XCTAssertEqual(start, "2026-06-02")
        XCTAssertEqual(end, "2026-06-04")
        XCTAssertEqual(count, 3)
    }

    func testThirtyDayGapCollapsesToSingleRange() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-04-01"),
            makeSession(id: "b", date: "2026-05-01"),
        ])
        XCTAssertEqual(rows.count, 3, "prior session must stay reachable: session, one range row, session")
        guard case .session(let first, _) = rows[0],
              case .missedRange(let start, let end, let count) = rows[1],
              case .session(let second, _) = rows[2] else {
            return XCTFail("expected session, missedRange, session")
        }
        XCTAssertEqual(first.id, "a")
        XCTAssertEqual(second.id, "b")
        XCTAssertEqual(start, "2026-04-02")
        XCTAssertEqual(end, "2026-04-30")
        XCTAssertEqual(count, 29)
    }

    func testGapSpanningQuickAndStandardSessions() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "s1", date: "2026-04-01"),
            makeSession(id: "q1", type: .quick, date: "2026-05-06"),
        ])
        XCTAssertEqual(rows.count, 3)
        guard case .missedRange(_, _, let count) = rows[1],
              case .session(let last, _) = rows[2] else {
            return XCTFail("expected missedRange then quick session")
        }
        XCTAssertEqual(count, 34)
        XCTAssertEqual(last.sessionType, .quick)
    }

    // MARK: - Gap adjacent to today (#379)

    func testLongGapAdjacentToTodayCollapses() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-05-01")],
            todayIsoDate: "2026-06-11"
        )
        XCTAssertEqual(rows.count, 2)
        guard case .missedRange(let start, let end, let count) = rows[1] else {
            return XCTFail("expected trailing missedRange before today")
        }
        XCTAssertEqual(start, "2026-05-02")
        XCTAssertEqual(end, "2026-06-10", "today itself is never emitted as missed")
        XCTAssertEqual(count, 40)
    }

    func testShortGapAdjacentToTodayEmitsPerDayRows() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-06-09")],
            todayIsoDate: "2026-06-11"
        )
        XCTAssertEqual(rows.count, 2)
        guard case .missed(let date) = rows[1] else {
            return XCTFail("expected one trailing missed row")
        }
        XCTAssertEqual(date, "2026-06-10")
    }

    func testNoTrailingGapWhenSessionIsToday() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-06-11")],
            todayIsoDate: "2026-06-11"
        )
        XCTAssertEqual(rows.count, 1)
        guard case .session = rows[0] else {
            return XCTFail("expected only the session row")
        }
    }

    func testNoTrailingGapWhenSessionWasYesterday() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-06-10")],
            todayIsoDate: "2026-06-11"
        )
        XCTAssertEqual(rows.count, 1)
    }

    func testEmptySessionsProduceNoRows() {
        XCTAssertTrue(HistoryJourney.buildRows(fromSessions: [], todayIsoDate: "2026-06-11").isEmpty)
    }

    // MARK: - Stats (quick sits intentionally excluded — #379)

    func testStreakCountsUniqueCalendarDays() {
        let stats = SessionStatistics.calculateStats(for: [
            makeSession(id: "1", date: "2026-04-28"),
            makeSession(id: "2", date: "2026-04-28"),
        ])
        XCTAssertEqual(stats.streak, 1)
    }

    func testStatsExcludeQuickSits() {
        let quickOnly = SessionStatistics.calculateStats(for: [
            makeSession(id: "q1", type: .quick, date: "2026-06-10", thoughtCount: 5),
        ])
        XCTAssertEqual(quickOnly.streak, 0)
        XCTAssertEqual(quickOnly.avgThoughtsPerSession, 0)

        let mixed = SessionStatistics.calculateStats(for: [
            makeSession(id: "s1", date: "2026-06-10", thoughtCount: 10),
            makeSession(id: "q1", type: .quick, date: "2026-06-11", thoughtCount: 5),
        ])
        XCTAssertEqual(mixed.streak, 1, "quick sit on a later day must not extend the streak")
        XCTAssertEqual(mixed.avgThoughtsPerSession, 10, "average must count standard sessions only")
    }
}
