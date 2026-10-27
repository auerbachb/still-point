import Foundation
import Testing
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the tick that ends a sit, its
/// completion cues, and a whole sit end to end.
struct SessionTickLogicCompletionTests: SessionTickLogicTestSupport {

    @Test func testTheTickThatReachesTheDurationEndsTheSitNaturally() {
        let before = cursor(tick: 299, minuteBlock: 3, hapticInterval: 4)
        let outcome = advance(
            300.03,
            total: 300,
            prefs: prefs(tick: true, chime: true, completion: true, haptics: true),
            cursor: before
        )

        #expect(outcome.completedNaturally)
        #expect(outcome.elapsed == 300)
        #expect(outcome.cursor == before)
        #expect(
            outcome.effects == SessionTickLogic.Effects(
                cancelVoiceCountdown: true,
                voiceCountdownSecond: nil,
                playTick: false,
                playChime: false,
                playCompletion: true,
                haptic: .sessionEnd
            )
        )
    }

    @Test func testCompletionCuesFollowTheirOwnPreferences() {
        let silent = advance(300, total: 300, prefs: prefs())
        #expect(silent.completedNaturally)
        #expect(silent.effects.cancelVoiceCountdown)
        #expect(!silent.effects.playCompletion)
        #expect(silent.effects.haptic == nil)

        // #712: silencing the completion sound must not silence the end buzz.
        let buzzOnly = advance(300, total: 300, prefs: prefs(haptics: true))
        #expect(!buzzOnly.effects.playCompletion)
        #expect(buzzOnly.effects.haptic == .sessionEnd)

        // The completion sound still plays in voice countdown mode.
        let voiceMode = advance(300, total: 300, prefs: prefs(completion: true, voice: true))
        #expect(voiceMode.effects.playCompletion)
    }

    @Test func testAnAbandonedSitGetsNoEndBuzz() {
        let outcome = advance(300, total: 300, prefs: prefs(haptics: true), abandoned: true)
        #expect(outcome.effects.haptic == nil)
    }

    @Test func testATickShortOfTheDurationDoesNotEndTheSit() {
        let outcome = advance(
            299.99,
            total: 300,
            prefs: prefs(completion: true, haptics: true),
            cursor: cursor(tick: 299, minuteBlock: 3, hapticInterval: 4)
        )
        #expect(!outcome.completedNaturally)
        #expect(outcome.elapsed == 299.99)
        #expect(!outcome.effects.playCompletion)
        #expect(outcome.effects.haptic == nil)
    }

    @Test func testABonusAddedBeforeTheEndKeepsTheSitRunning() {
        let outcome = advance(300.5, total: 330, prefs: prefs(completion: true))
        #expect(!outcome.completedNaturally)
        #expect(outcome.elapsed == 300.5)
        #expect(!outcome.effects.playCompletion)
    }

    // MARK: - A whole sit

    @Test func testAThreeMinuteSitTicksEverySecondRingsTwiceAndCompletesOnce() {
        let effects = simulateSit(total: 180, prefs: prefs(tick: true, chime: true, completion: true))
        // Whole seconds 1 to 179; the 180th tick is the completing one.
        #expect(effects.filter(\.playTick).count == 179)
        // Bells at 60 and 120, each with at least a full minute to go.
        #expect(effects.filter(\.playChime).count == 2)
        #expect(effects.filter(\.playCompletion).count == 1)
        #expect(effects.last?.playCompletion == true)
    }
}
