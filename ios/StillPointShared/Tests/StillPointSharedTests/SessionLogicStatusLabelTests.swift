import Foundation
import Testing
@testable import StillPointShared

struct SessionLogicStatusLabelTests {
    @Test func testMinuteZoneLabelUsesFullSessionMinuteCount() {
        let totalSeconds = 260
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 61,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        #expect(label == "minute 2 of 5")
    }

    @Test func testFinalMinutePartialBlockKeepsCurrentMinuteLabel() {
        let totalSeconds = 260
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 255,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        #expect(label == "minute 4 of 5")
    }

    @Test func testFinalTenSecondBlocksRolloverAtMinuteBoundary() {
        let totalSeconds = 420
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 420,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        #expect(label == "minute 7 of 7")
    }

    @Test func testShortSessionsStillShowSessionCompleteAtEnd() {
        let totalSeconds = 120
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 120,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        #expect(label == "session complete")
    }
}
