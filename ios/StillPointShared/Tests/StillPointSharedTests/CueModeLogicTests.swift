import Foundation
import Testing
@testable import StillPointShared

struct CueModeLogicTests {

    private func prefs(
        tick: Bool,
        haptics: Bool,
        voice: Bool,
        chime: Bool = true,
        completion: Bool = false
    ) -> AudioEngine.SoundPrefs {
        AudioEngine.SoundPrefs(
            tick: tick,
            chime: chime,
            completion: completion,
            voiceCountdown: voice,
            haptics: haptics
        )
    }

    private func assertExclusive(
        _ result: AudioEngine.SoundPrefs,
        mode: CueMode,
        sourceLocation: SourceLocation = #_sourceLocation
    ) {
        #expect(result.tick == (mode == .tick), sourceLocation: sourceLocation)
        #expect(result.haptics == (mode == .haptic), sourceLocation: sourceLocation)
        #expect(result.voiceCountdown == (mode == .voice), sourceLocation: sourceLocation)
    }

    @Test func testExactlyOneOnKeepsThatMode() {
        assertExclusive(CueModeLogic.normalized(prefs(tick: true, haptics: false, voice: false)), mode: .tick)
        assertExclusive(CueModeLogic.normalized(prefs(tick: false, haptics: true, voice: false)), mode: .haptic)
        assertExclusive(CueModeLogic.normalized(prefs(tick: false, haptics: false, voice: true)), mode: .voice)
    }

    @Test func testMultipleOnPrefersTickThenHapticsThenVoice() {
        assertExclusive(
            CueModeLogic.normalized(prefs(tick: true, haptics: true, voice: true)),
            mode: .tick
        )
        assertExclusive(
            CueModeLogic.normalized(prefs(tick: true, haptics: false, voice: true)),
            mode: .tick
        )
        assertExclusive(
            CueModeLogic.normalized(prefs(tick: false, haptics: true, voice: true)),
            mode: .haptic
        )
    }

    @Test func testNoneOnBecomesTick() {
        assertExclusive(
            CueModeLogic.normalized(prefs(tick: false, haptics: false, voice: false)),
            mode: .tick
        )
    }

    @Test func testNormalizeLeavesChimeAndCompletionAlone() {
        let original = prefs(tick: true, haptics: true, voice: false, chime: false, completion: true)
        let result = CueModeLogic.normalized(original)
        #expect(!result.chime)
        #expect(result.completion)
        assertExclusive(result, mode: .tick)
    }

    @Test func testTransitionIntoVoiceWarmsAndPreloads() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: true, haptics: false, voice: false),
            to: prefs(tick: false, haptics: false, voice: true)
        )
        #expect(effects.warmUp)
        #expect(effects.preloadVoiceCountdown)
        #expect(!effects.cancelVoiceCountdown)
        #expect(!effects.resetVoiceDedup)
    }

    @Test func testTransitionIntoSilentHapticDoesNotWarmAudio() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: true, haptics: false, voice: false, chime: false, completion: false),
            to: prefs(tick: false, haptics: true, voice: false, chime: false, completion: false)
        )
        #expect(!effects.warmUp)
        #expect(!effects.preloadVoiceCountdown)
        #expect(!effects.cancelVoiceCountdown)
    }

    /// #1176 (owner decision): haptic mode rings no minute bell, so the stored
    /// bell alone is no reason to warm the session on the way in.
    @Test func testTransitionIntoHapticWithOnlyChimeOnStaysCold() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: true, haptics: false, voice: false, chime: true),
            to: prefs(tick: false, haptics: true, voice: false, chime: true)
        )
        #expect(!effects.warmUp)
        #expect(!effects.preloadVoiceCountdown)
        #expect(!effects.cancelVoiceCountdown)
    }

    /// #1176: the end sound alone is enough to warm the session.
    @Test func testTransitionIntoHapticWithOnlyCompletionOnWarmsAudio() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: false, haptics: false, voice: true, chime: false, completion: true),
            to: prefs(tick: false, haptics: true, voice: false, chime: false, completion: true)
        )
        #expect(effects.warmUp)
        #expect(effects.cancelVoiceCountdown)
    }

    /// Staying in haptic mode is not a transition into it.
    @Test func testStayingInHapticDoesNotRewarm() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: false, haptics: true, voice: false, chime: true),
            to: prefs(tick: false, haptics: true, voice: false, chime: true)
        )
        #expect(!effects.warmUp)
    }

    @Test func testLeavingVoiceCancelsAndResetsDedup() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: false, haptics: false, voice: true),
            to: prefs(tick: true, haptics: false, voice: false)
        )
        #expect(effects.warmUp)
        #expect(effects.cancelVoiceCountdown)
        #expect(effects.resetVoiceDedup)
        #expect(!effects.preloadVoiceCountdown)
    }
}
