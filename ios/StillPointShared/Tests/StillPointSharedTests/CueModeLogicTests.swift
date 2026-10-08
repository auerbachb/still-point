import XCTest
@testable import StillPointShared

final class CueModeLogicTests: XCTestCase {

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
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertEqual(result.tick, mode == .tick, file: file, line: line)
        XCTAssertEqual(result.haptics, mode == .haptic, file: file, line: line)
        XCTAssertEqual(result.voiceCountdown, mode == .voice, file: file, line: line)
    }

    func testExactlyOneOnKeepsThatMode() {
        assertExclusive(CueModeLogic.normalized(prefs(tick: true, haptics: false, voice: false)), mode: .tick)
        assertExclusive(CueModeLogic.normalized(prefs(tick: false, haptics: true, voice: false)), mode: .haptic)
        assertExclusive(CueModeLogic.normalized(prefs(tick: false, haptics: false, voice: true)), mode: .voice)
    }

    func testMultipleOnPrefersTickThenHapticsThenVoice() {
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

    func testNoneOnBecomesTick() {
        assertExclusive(
            CueModeLogic.normalized(prefs(tick: false, haptics: false, voice: false)),
            mode: .tick
        )
    }

    func testNormalizeLeavesChimeAndCompletionAlone() {
        let original = prefs(tick: true, haptics: true, voice: false, chime: false, completion: true)
        let result = CueModeLogic.normalized(original)
        XCTAssertFalse(result.chime)
        XCTAssertTrue(result.completion)
        assertExclusive(result, mode: .tick)
    }

    func testTransitionIntoVoiceWarmsAndPreloads() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: true, haptics: false, voice: false),
            to: prefs(tick: false, haptics: false, voice: true)
        )
        XCTAssertTrue(effects.warmUp)
        XCTAssertTrue(effects.preloadVoiceCountdown)
        XCTAssertFalse(effects.cancelVoiceCountdown)
        XCTAssertFalse(effects.resetVoiceDedup)
    }

    func testTransitionIntoHapticDoesNotWarmAudio() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: true, haptics: false, voice: false),
            to: prefs(tick: false, haptics: true, voice: false)
        )
        XCTAssertFalse(effects.warmUp)
        XCTAssertFalse(effects.preloadVoiceCountdown)
        XCTAssertFalse(effects.cancelVoiceCountdown)
    }

    func testLeavingVoiceCancelsAndResetsDedup() {
        let effects = CueModeLogic.transitionEffects(
            from: prefs(tick: false, haptics: false, voice: true),
            to: prefs(tick: true, haptics: false, voice: false)
        )
        XCTAssertTrue(effects.warmUp)
        XCTAssertTrue(effects.cancelVoiceCountdown)
        XCTAssertTrue(effects.resetVoiceDedup)
        XCTAssertFalse(effects.preloadVoiceCountdown)
    }
}
