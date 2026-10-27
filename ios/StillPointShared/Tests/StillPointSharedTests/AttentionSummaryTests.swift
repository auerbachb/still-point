import Foundation
import Testing
@testable import StillPointShared

struct AttentionSummaryTests {
    @Test func testEmptyLogAssumesInitialAttentiveState() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [],
            totalElapsed: 120
        )
        #expect(summary.attentivePercent == 100)
        #expect(summary.awayPercent == 0)
    }

    @Test func testSingleAwaySegment() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [AttentionEntry(time: 30, state: "away")],
            totalElapsed: 60
        )
        #expect(summary.attentivePercent == 50)
        #expect(summary.awayPercent == 50)
    }

    @Test func testMultipleSegments() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [
                AttentionEntry(time: 10, state: "away"),
                AttentionEntry(time: 40, state: "attentive"),
            ],
            totalElapsed: 60
        )
        #expect(summary.attentivePercent == 50)
        #expect(summary.awayPercent == 50)
    }

    @Test func testZeroElapsedReturnsFullAttentive() {
        let summary = AttentionTrackingLogic.calculateAttentionSummary(
            log: [AttentionEntry(time: 0, state: "away")],
            totalElapsed: 0
        )
        #expect(summary.attentivePercent == 100)
        #expect(summary.awayPercent == 0)
    }
}
