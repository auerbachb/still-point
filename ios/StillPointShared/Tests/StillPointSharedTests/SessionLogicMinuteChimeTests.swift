import Foundation
import Testing
@testable import StillPointShared

struct SessionLogicMinuteChimeTests {
    @Test func testFourTwentySessionChimesAtThreeTwentyTwoTwentyOneTwentyOnly() {
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

        #expect(chimes == [3, 2, 1], "Expected chimes at 3:20, 2:20, 1:20 only")
    }

    @Test func testExactFiveMinuteSessionChimesAtFourThreeTwoOne() {
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

        #expect(chimes == [4, 3, 2, 1])
    }

    @Test func testNoMinuteChimeWhenLessThanOneMinuteRemains() {
        let totalSeconds = 260
        let update = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 240.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: 2
        )

        #expect(update.updatedCompletedBlockIndex == 3)
        #expect(update.chimeCount == nil)
    }

    @Test func testNoMinuteBlockChimesForSessionsAtOrBelowOneHundredTwentySeconds() {
        for duration in [120, 110, 60] {
            let update = SessionLogic.nextMinuteChimeUpdate(
                elapsed: 60.0,
                totalSeconds: duration,
                lastCompletedBlockIndex: -1
            )
            #expect(update.updatedCompletedBlockIndex == -1, "Duration \(duration) should not use minute blocks")
            #expect(update.chimeCount == nil, "Duration \(duration) should not produce minute-block chimes")
        }
    }

    @Test func testBlockProgressAdvancesEvenIfChimePlaybackIsMuted() {
        let totalSeconds = 260
        let mutedUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 60.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: -1
        )
        #expect(mutedUpdate.updatedCompletedBlockIndex == 0)
        #expect(mutedUpdate.chimeCount == 3)

        // Simulate unmuting after the boundary: no replay for already-completed block.
        let unmutedUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 61.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: mutedUpdate.updatedCompletedBlockIndex
        )
        #expect(unmutedUpdate.updatedCompletedBlockIndex == 0)
        #expect(unmutedUpdate.chimeCount == nil)
    }

    @Test func testPauseResumeSeedPreventsReplayingCompletedMinuteBlockChimes() {
        let totalSeconds = 260
        let seededIndex = SessionLogic.completedMinuteBlockIndex(
            elapsed: 130.0,
            totalSeconds: totalSeconds
        )
        #expect(seededIndex == 1)

        let afterResume = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 131.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: seededIndex
        )
        #expect(afterResume.updatedCompletedBlockIndex == seededIndex)
        #expect(afterResume.chimeCount == nil)
    }

    @Test func testFreshSessionStartDoesNotInheritCompletedMinuteBlocks() {
        let totalSeconds = 260

        let freshUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 0.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: -1
        )
        #expect(freshUpdate.updatedCompletedBlockIndex == -1)
        #expect(freshUpdate.chimeCount == nil)

        let firstBoundary = SessionLogic.nextMinuteChimeUpdate(
            elapsed: 60.0,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: freshUpdate.updatedCompletedBlockIndex
        )
        #expect(firstBoundary.updatedCompletedBlockIndex == 0)
        #expect(firstBoundary.chimeCount == 3)
    }
}
