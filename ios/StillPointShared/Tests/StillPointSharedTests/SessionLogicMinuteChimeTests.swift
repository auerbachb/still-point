import XCTest
@testable import StillPointShared

final class SessionLogicMinuteChimeTests: XCTestCase {
    func testFourTwentySessionChimesAtThreeTwentyTwoTwentyOneTwentyOnly() {
        let totalSeconds = 260
        var lastCompletedBlockIndex = -1
        var chimes: [Int] = []

        for elapsed in [60.0, 120.0, 180.0, 240.0, 250.0] {
            let update = SessionLogic.nextMinuteChimeUpdate(
                elapsed: elapsed,
                totalSeconds: totalSeconds,
                lastCompletedBlockIndex: lastCompletedBlockIndex
            )
            lastCompletedBlockIndex = update.updatedCompletedBlockIndex
            if let chime = update.chimeCount {
                chimes.append(chime)
            }
        }

        XCTAssertEqual(chimes, [3, 2, 1], "Expected chimes at 3:20, 2:20, 1:20 only")
    }

    func testExactFiveMinuteSessionChimesAtFourThreeTwoOne() {
        let totalSeconds = 300
        var lastCompletedBlockIndex = -1
        var chimes: [Int] = []

        for elapsed in [60.0, 120.0, 180.0, 240.0] {
            let update = SessionLogic.nextMinuteChimeUpdate(
                elapsed: elapsed,
                totalSeconds: totalSeconds,
                lastCompletedBlockIndex: lastCompletedBlockIndex
            )
            lastCompletedBlockIndex = update.updatedCompletedBlockIndex
            if let chime = update.chimeCount {
                chimes.append(chime)
            }
        }

        XCTAssertEqual(chimes, [4, 3, 2, 1])
    }

    func testNoMinuteChimeWhenLessThanOneMinuteRemains() {
        let totalSeconds = 260
        let update = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 240.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: 2
        )

        XCTAssertEqual(update.updatedCompletedBlockIndex, 3)
        XCTAssertNil(update.chimeCount)
    }

    func testNoMinuteBlockChimesForSessionsAtOrBelowOneHundredTwentySeconds() {
        for duration in [120, 110, 60] {
            let update = SessionLogic.nextMinuteChimeUpdate(
                elapsed: 60.0,
                totalSeconds: duration,
                lastCompletedBlockIndex: -1
            )
            XCTAssertEqual(update.updatedCompletedBlockIndex, -1, "Duration \(duration) should not use minute blocks")
            XCTAssertNil(update.chimeCount, "Duration \(duration) should not produce minute-block chimes")
        }
    }

    func testBlockProgressAdvancesEvenIfChimePlaybackIsMuted() {
        let totalSeconds = 260
        let mutedUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 60.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: -1
        )
        XCTAssertEqual(mutedUpdate.updatedCompletedBlockIndex, 0)
        XCTAssertEqual(mutedUpdate.chimeCount, 3)

        // Simulate unmuting after the boundary: no replay for already-completed block.
        let unmutedUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 61.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: mutedUpdate.updatedCompletedBlockIndex
        )
        XCTAssertEqual(unmutedUpdate.updatedCompletedBlockIndex, 0)
        XCTAssertNil(unmutedUpdate.chimeCount)
    }

    func testPauseResumeSeedPreventsReplayingCompletedMinuteBlockChimes() {
        let totalSeconds = 260
        let seededIndex = SessionLogic.completedMinuteBlockIndex(
            elapsed: 130.0,
            totalSeconds: totalSeconds
        )
        XCTAssertEqual(seededIndex, 1)

        let afterResume = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 131.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: seededIndex
        )
        XCTAssertEqual(afterResume.updatedCompletedBlockIndex, seededIndex)
        XCTAssertNil(afterResume.chimeCount)
    }

    func testFreshSessionStartDoesNotInheritCompletedMinuteBlocks() {
        let totalSeconds = 260

        let freshUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 0.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: -1
        )
        XCTAssertEqual(freshUpdate.updatedCompletedBlockIndex, -1)
        XCTAssertNil(freshUpdate.chimeCount)

        let firstBoundary = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 60.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: freshUpdate.updatedCompletedBlockIndex
        )
        XCTAssertEqual(firstBoundary.updatedCompletedBlockIndex, 0)
        XCTAssertEqual(firstBoundary.chimeCount, 3)
    }
}
