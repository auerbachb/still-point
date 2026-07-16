import XCTest
@testable import StillPointShared

final class AttentionSummaryTests: XCTestCase {
    func testEmptyLogAssumesInitialAttentiveState() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [],
            totalElapsed: 120
        )
        XCTAssertEqual(summary.attentivePercent, 100)
        XCTAssertEqual(summary.awayPercent, 0)
    }

    func testSingleAwaySegment() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [AttentionEntry(time: 30, state: "away")],
            totalElapsed: 60
        )
        XCTAssertEqual(summary.attentivePercent, 50)
        XCTAssertEqual(summary.awayPercent, 50)
    }

    func testMultipleSegments() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [
                AttentionEntry(time: 10, state: "away"),
                AttentionEntry(time: 40, state: "attentive"),
            ],
            totalElapsed: 60
        )
        XCTAssertEqual(summary.attentivePercent, 50)
        XCTAssertEqual(summary.awayPercent, 50)
    }

    func testZeroElapsedReturnsFullAttentive() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [AttentionEntry(time: 0, state: "away")],
            totalElapsed: 0
        )
        XCTAssertEqual(summary.attentivePercent, 100)
        XCTAssertEqual(summary.awayPercent, 0)
    }
}
