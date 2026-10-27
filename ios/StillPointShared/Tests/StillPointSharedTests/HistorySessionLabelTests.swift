import XCTest
@testable import StillPointShared

/// #898: the History row label, including a combined sit's "Combined".
final class HistorySessionLabelTests: XCTestCase {
    private func label(
        _ type: SessionType,
        combined: Bool? = nil,
        breathCount: Int? = nil,
        focusCategory: FocusCategory? = nil,
        index: Int = 2
    ) -> String {
        HistorySessionLabel.label(
            sessionType: type,
            combined: combined,
            breathCount: breathCount,
            focusCategory: focusCategory,
            indexInDay: index
        )
    }

    func testCombinedStandardSitReadsCombinedWithNoOrdinal() {
        XCTAssertEqual(label(.standard, combined: true), "Combined")
    }

    func testOrdinaryStandardSitReadsSessionN() {
        XCTAssertEqual(label(.standard), "Session 2")
        XCTAssertEqual(label(.standard, combined: false, index: 1), "Session 1")
    }

    func testQuickSitKeepsItsOrdinal() {
        XCTAssertEqual(label(.quick), "Quick 2")
        // Only a standard row can be combined; a stray flag changes nothing.
        XCTAssertEqual(label(.quick, combined: true), "Quick 2")
    }

    func testBreathSitShowsCountOrOrdinal() {
        XCTAssertEqual(label(.breath, breathCount: 12), "Breath 12b")
        XCTAssertEqual(label(.breath, breathCount: 0), "Breath 2")
        XCTAssertEqual(label(.breath), "Breath 2")
        XCTAssertEqual(label(.breath, combined: true), "Breath 2")
    }

    func testFocusSessionReadsItsCategory() {
        XCTAssertEqual(label(.focus), "Focus")
        XCTAssertEqual(
            label(.focus, focusCategory: .reading),
            "Focus \u{00B7} \(FocusCategory.reading.displayLabel)"
        )
    }

    func testSessionDTOOverloadReadsTheRow() {
        let row = SessionDTO(
            id: "s1",
            dayNumber: 5,
            sessionType: .standard,
            duration: 600,
            completed: true,
            actualTime: 600,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: "2026-10-27",
            buddySessionId: nil,
            combined: true
        )
        XCTAssertEqual(HistorySessionLabel.label(for: row, indexInDay: 1), "Combined")
    }
}
