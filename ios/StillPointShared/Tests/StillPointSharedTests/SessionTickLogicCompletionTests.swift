import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the tick that ends a sit, its
/// completion cues, and a whole sit end to end.
final class SessionTickLogicCompletionTests: XCTestCase, SessionTickLogicTestSupport {

    func testTheTickThatReachesTheDurationEndsTheSitNaturally() {
        let before = cursor(tick: 299, minuteBlock: 3, hapticInterval: 4)
        let outcome = advance(
            300.03,
            total: 300,
            prefs: prefs(tick: true, chime: true, completion: true, haptics: true),
            cursor: before
        )

        XCTAssertTrue(outcome.completedNaturally)
        XCTAssertEqual(outcome.elapsed, 300)
        XCTAssertEqual(outcome.cursor, before)
        XCTAssertEqual(
            outcome.effects,
            SessionTickLogic.Effects(
                cancelVoiceCountdown: true,
                voiceCountdownSecond: nil,
                playTick: false,
                playChime: false,
                playCompletion: true,
                haptic: .sessionEnd
            )
        )
    }

    func testCompletionCuesFollowTheirOwnPreferences() {
        let silent = advance(300, total: 300, prefs: prefs())
        XCTAssertTrue(silent.completedNaturally)
        XCTAssertTrue(silent.effects.cancelVoiceCountdown)
        XCTAssertFalse(silent.effects.playCompletion)
        XCTAssertNil(silent.effects.haptic)

        // #712: silencing the completion sound must not silence the end buzz.
        let buzzOnly = advance(300, total: 300, prefs: prefs(haptics: true))
        XCTAssertFalse(buzzOnly.effects.playCompletion)
        XCTAssertEqual(buzzOnly.effects.haptic, .sessionEnd)

        // The completion sound still plays in voice countdown mode.
        let voiceMode = advance(300, total: 300, prefs: prefs(completion: true, voice: true))
        XCTAssertTrue(voiceMode.effects.playCompletion)
    }

    func testAnAbandonedSitGetsNoEndBuzz() {
        let outcome = advance(300, total: 300, prefs: prefs(haptics: true), abandoned: true)
        XCTAssertNil(outcome.effects.haptic)
    }

    func testATickShortOfTheDurationDoesNotEndTheSit() {
        let outcome = advance(
            299.99,
            total: 300,
            prefs: prefs(completion: true, haptics: true),
            cursor: cursor(tick: 299, minuteBlock: 3, hapticInterval: 4)
        )
        XCTAssertFalse(outcome.completedNaturally)
        XCTAssertEqual(outcome.elapsed, 299.99)
        XCTAssertFalse(outcome.effects.playCompletion)
        XCTAssertNil(outcome.effects.haptic)
    }

    func testABonusAddedBeforeTheEndKeepsTheSitRunning() {
        let outcome = advance(300.5, total: 330, prefs: prefs(completion: true))
        XCTAssertFalse(outcome.completedNaturally)
        XCTAssertEqual(outcome.elapsed, 300.5)
        XCTAssertFalse(outcome.effects.playCompletion)
    }

    // MARK: - A whole sit

    func testAThreeMinuteSitTicksEverySecondRingsTwiceAndCompletesOnce() {
        let effects = simulateSit(total: 180, prefs: prefs(tick: true, chime: true, completion: true))
        // Whole seconds 1 to 179; the 180th tick is the completing one.
        XCTAssertEqual(effects.filter(\.playTick).count, 179)
        // Bells at 60 and 120, each with at least a full minute to go.
        XCTAssertEqual(effects.filter(\.playChime).count, 2)
        XCTAssertEqual(effects.filter(\.playCompletion).count, 1)
        XCTAssertEqual(effects.last?.playCompletion, true)
    }
}
