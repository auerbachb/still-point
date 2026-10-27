import Foundation
import Testing
@testable import StillPointShared

/// #898: the History row label, including a combined sit's "Combined".
struct HistorySessionLabelTests {
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

    @Test func testCombinedStandardSitReadsCombinedWithNoOrdinal() {
        #expect(label(.standard, combined: true) == "Combined")
    }

    @Test func testOrdinaryStandardSitReadsSessionN() {
        #expect(label(.standard) == "Session 2")
        #expect(label(.standard, combined: false, index: 1) == "Session 1")
    }

    @Test func testQuickSitKeepsItsOrdinal() {
        #expect(label(.quick) == "Quick 2")
        // Only a standard row can be combined; a stray flag changes nothing.
        #expect(label(.quick, combined: true) == "Quick 2")
    }

    @Test func testBreathSitShowsCountOrOrdinal() {
        #expect(label(.breath, breathCount: 12) == "Breath 12b")
        #expect(label(.breath, breathCount: 0) == "Breath 2")
        #expect(label(.breath) == "Breath 2")
        #expect(label(.breath, combined: true) == "Breath 2")
    }

    @Test func testFocusSessionReadsItsCategory() {
        #expect(label(.focus) == "Focus")
        #expect(label(.focus, focusCategory: .reading) == "Focus \u{00B7} \(FocusCategory.reading.displayLabel)")
    }

    @Test func testSessionDTOOverloadReadsTheRow() {
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
        #expect(HistorySessionLabel.label(for: row, indexInDay: 1) == "Combined")
    }
}
