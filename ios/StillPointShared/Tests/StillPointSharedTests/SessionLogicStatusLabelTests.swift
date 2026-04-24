import XCTest
@testable import StillPointShared

final class SessionLogicStatusLabelTests: XCTestCase {
    func testMinuteZoneLabelUsesFullSessionMinuteCount() {
        let totalSeconds = 260
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 61,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        XCTAssertEqual(label, "minute 2 of 5")
    }

    func testFinalMinutePartialBlockKeepsCurrentMinuteLabel() {
        let totalSeconds = 260
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 255,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        XCTAssertEqual(label, "minute 4 of 5")
    }

    func testFinalTenSecondBlocksRolloverAtMinuteBoundary() {
        let totalSeconds = 420
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 420,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        XCTAssertEqual(label, "minute 7 of 7")
    }

    func testShortSessionsStillShowSessionCompleteAtEnd() {
        let totalSeconds = 120
        let blocks = SessionLogic.buildBlocks(totalSeconds: totalSeconds)

        let label = SessionLogic.statusLabel(
            elapsed: 120,
            totalSeconds: totalSeconds,
            blocks: blocks
        )

        XCTAssertEqual(label, "session complete")
    }
}
