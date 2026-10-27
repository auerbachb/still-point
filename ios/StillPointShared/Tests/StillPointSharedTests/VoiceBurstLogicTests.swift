import XCTest
@testable import StillPointShared

/// #941: a clip still playing stops only for a clip that starts under half a
/// second after it, as web's `playVoiceCountdown` does (#922).
final class VoiceBurstLogicTests: XCTestCase {

    // MARK: - shouldStopClip

    func testBurstWindowMatchesWeb() {
        // `VOICE_BURST_WINDOW_S` in src/lib/audio.ts.
        XCTAssertEqual(VoiceBurstLogic.voiceBurstWindowSeconds, 0.5)
    }

    func testClipFromTheSecondBeforeIsNotStopped() {
        // "27" speaks until 1.15 s; the next number starts 1 s after it.
        XCTAssertFalse(VoiceBurstLogic.shouldStopClip(startedAt: 33, whenNextStartsAt: 34))
    }

    func testClipUnderHalfASecondOldIsStopped() {
        XCTAssertTrue(VoiceBurstLogic.shouldStopClip(startedAt: 15, whenNextStartsAt: 15.05))
        XCTAssertTrue(VoiceBurstLogic.shouldStopClip(startedAt: 15, whenNextStartsAt: 15.499))
    }

    func testClipExactlyHalfASecondOldIsNotStopped() {
        // Web keeps a clip that started exactly `now - VOICE_BURST_WINDOW_S`.
        XCTAssertFalse(VoiceBurstLogic.shouldStopClip(startedAt: 15, whenNextStartsAt: 15.5))
    }

    // MARK: - Clips

    func testOneSecondStepLetsThePreviousClipPlayOut() {
        var clips = VoiceBurstLogic.Clips()
        XCTAssertEqual(clips.start(at: 33), VoiceBurstLogic.Plan(stop: [], playOn: 0)) // "28"
        // "27" a second later: "28" is neither stopped nor replaced on its player.
        XCTAssertEqual(clips.start(at: 34), VoiceBurstLogic.Plan(stop: [], playOn: 1))
    }

    func testBurstStopsThePreviousClip() {
        var clips = VoiceBurstLogic.Clips()
        XCTAssertEqual(clips.start(at: 15), VoiceBurstLogic.Plan(stop: [], playOn: 0)) // "60"
        // "59" 50 ms later stops "60" and takes its player, so clips cannot stack.
        XCTAssertEqual(clips.start(at: 15.05), VoiceBurstLogic.Plan(stop: [0], playOn: 0))
    }

    func testClipJustUnderHalfASecondOldIsStoppedForTheNext() {
        var clips = VoiceBurstLogic.Clips()
        _ = clips.start(at: 10)
        XCTAssertEqual(clips.start(at: 10.499), VoiceBurstLogic.Plan(stop: [0], playOn: 0))
    }

    func testClipExactlyHalfASecondOldPlaysOutBesideTheNext() {
        var clips = VoiceBurstLogic.Clips()
        _ = clips.start(at: 10)
        XCTAssertEqual(clips.start(at: 10.5), VoiceBurstLogic.Plan(stop: [], playOn: 1))
    }

    func testBurstLeavesTheClipFromTheSecondBeforePlaying() {
        var clips = VoiceBurstLogic.Clips()
        _ = clips.start(at: 33) // "28" on player 0
        _ = clips.start(at: 34) // "27" on player 1
        // An update 50 ms after "27" stops "27" alone; "28" still plays out.
        XCTAssertEqual(clips.start(at: 34.05), VoiceBurstLogic.Plan(stop: [1], playOn: 1))
    }

    func testOneSecondStepsRotateThroughThePlayersAndStopNothing() {
        var clips = VoiceBurstLogic.Clips()
        let plans = (0..<6).map { clips.start(at: 30 + Double($0)) }
        XCTAssertEqual(plans.map(\.playOn), [0, 1, 2, 3, 0, 1])
        XCTAssertTrue(plans.allSatisfy { $0.stop.isEmpty })
    }

    func testFullPlayersReplaceTheClipThatStartedFirst() {
        var clips = VoiceBurstLogic.Clips()
        for start in [10.0, 10.5, 11.0, 11.5] {
            _ = clips.start(at: start) // players 0 to 3; each earlier clip plays out
        }
        // No clip is in the burst window, so the new one takes the player whose
        // clip started first.
        XCTAssertEqual(clips.start(at: 12.1), VoiceBurstLogic.Plan(stop: [], playOn: 0))
    }

    func testNumberHalfASecondAfterTwoOthersLeavesTheFirstPlaying() {
        var clips = VoiceBurstLogic.Clips()
        _ = clips.start(at: 0)   // player 0
        _ = clips.start(at: 0.5) // player 1
        // The clip from 0 s may still be speaking and is outside the burst
        // window, so the number at 1 s must not take its player.
        XCTAssertEqual(clips.start(at: 1), VoiceBurstLogic.Plan(stop: [], playOn: 2))
    }

    func testNumbersHalfASecondApartNeverCutOffAClipStillPlaying() {
        // Web lets every clip outside the burst window play out, however many
        // overlap. "27" holds the longest bundled clip buffer.
        let longestClipSeconds = 1.7
        var clips = VoiceBurstLogic.Clips()
        var heldSince: [Int: TimeInterval] = [:]
        for step in 0..<12 {
            let now = 10 + 0.5 * Double(step)
            let plan = clips.start(at: now)
            XCTAssertEqual(plan.stop, [], "no clip is in the burst window at \(now)")
            if let startedAt = heldSince[plan.playOn] {
                XCTAssertGreaterThanOrEqual(
                    now - startedAt, longestClipSeconds,
                    "the clip from \(startedAt) lost its player at \(now)"
                )
            }
            heldSince[plan.playOn] = now
        }
    }

    func testBurstWindowCountsFromWhenAClipBeganToPlay() {
        var clips = VoiceBurstLogic.Clips()
        // "60" is planned at 15 but begins to play at 15.6, once a stopped
        // engine has restarted.
        let plan = clips.start(at: 15)
        clips.moveStart(of: plan.playOn, to: 15.6)
        // "59" 50 ms after "60" began stops it, so the two cannot overlap.
        XCTAssertEqual(clips.start(at: 15.65), VoiceBurstLogic.Plan(stop: [0], playOn: 0))
    }

    func testMovingTheStartOfAFreePlayerRecordsNoClip() {
        var clips = VoiceBurstLogic.Clips()
        clips.moveStart(of: 1, to: 10)
        clips.moveStart(of: VoiceBurstLogic.playerCount, to: 10) // no such player
        XCTAssertEqual(clips.stopAll(), [])
    }

    func testCancelStopsEveryClip() {
        var clips = VoiceBurstLogic.Clips()
        _ = clips.start(at: 33)
        _ = clips.start(at: 34)
        XCTAssertEqual(clips.stopAll(), [0, 1])
        // Both players are free again, so a clip right after stops nothing.
        XCTAssertEqual(clips.start(at: 34.1), VoiceBurstLogic.Plan(stop: [], playOn: 0))
    }

    func testCancelWithNothingPlayingStopsNothing() {
        var clips = VoiceBurstLogic.Clips()
        XCTAssertEqual(clips.stopAll(), [])
    }
}
