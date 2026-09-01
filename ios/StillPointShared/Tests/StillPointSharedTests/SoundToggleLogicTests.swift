import XCTest
@testable import StillPointShared

final class SoundToggleLogicTests: XCTestCase {

    /// Convenience for the three non-voice sounds: the toggled key changes while
    /// `voiceCountdown` stays put.
    private func effectsForNonVoiceToggle(
        wasEnabled: Bool,
        voiceCountdown: Bool = false
    ) -> SoundToggleLogic.Effects {
        SoundToggleLogic.effects(
            toggledKeyWasEnabled: wasEnabled,
            toggledKeyIsEnabled: !wasEnabled,
            voiceCountdownWasEnabled: voiceCountdown,
            voiceCountdownIsEnabled: voiceCountdown
        )
    }

    /// Convenience for the voice toggle itself: both pairs move together.
    private func effectsForVoiceToggle(wasEnabled: Bool) -> SoundToggleLogic.Effects {
        SoundToggleLogic.effects(
            toggledKeyWasEnabled: wasEnabled,
            toggledKeyIsEnabled: !wasEnabled,
            voiceCountdownWasEnabled: wasEnabled,
            voiceCountdownIsEnabled: !wasEnabled
        )
    }

    // MARK: - warmUp (#667)

    func testOffToOnTransitionWarmsUp() {
        XCTAssertTrue(effectsForNonVoiceToggle(wasEnabled: false).warmUp)
    }

    func testOnToOffTransitionDoesNotWarmUp() {
        XCTAssertFalse(effectsForNonVoiceToggle(wasEnabled: true).warmUp)
    }

    /// All four toggles route through the single `toggleSound` path, so one
    /// decision function has to cover tick, chime, end, and voice alike.
    func testEveryKeyWarmsUpOnEnableAndNotOnDisable() {
        // tick / chime / end: voiceCountdown is untouched by the toggle.
        for voiceState in [false, true] {
            XCTAssertTrue(
                effectsForNonVoiceToggle(wasEnabled: false, voiceCountdown: voiceState).warmUp,
                "off→on must warm up (voiceCountdown = \(voiceState))"
            )
            XCTAssertFalse(
                effectsForNonVoiceToggle(wasEnabled: true, voiceCountdown: voiceState).warmUp,
                "on→off must not warm up (voiceCountdown = \(voiceState))"
            )
        }

        // voice: the toggled key and voiceCountdown move together.
        XCTAssertTrue(effectsForVoiceToggle(wasEnabled: false).warmUp)
        XCTAssertFalse(effectsForVoiceToggle(wasEnabled: true).warmUp)
    }

    func testNoTransitionDoesNotWarmUp() {
        // Defensive: identical before/after values are not an off→on transition.
        let unchanged = SoundToggleLogic.effects(
            toggledKeyWasEnabled: true,
            toggledKeyIsEnabled: true,
            voiceCountdownWasEnabled: true,
            voiceCountdownIsEnabled: true
        )
        XCTAssertFalse(unchanged.warmUp)
        XCTAssertFalse(unchanged.preloadVoiceCountdown)
        XCTAssertFalse(unchanged.cancelVoiceCountdown)
        XCTAssertFalse(unchanged.resetVoiceDedup)
    }

    // MARK: - Voice countdown (#554 behavior preserved)

    func testVoiceOffToOnPreloadsAndDoesNotResetDedup() {
        let effects = effectsForVoiceToggle(wasEnabled: false)
        XCTAssertTrue(effects.preloadVoiceCountdown)
        XCTAssertFalse(effects.cancelVoiceCountdown)
        XCTAssertFalse(effects.resetVoiceDedup)
    }

    func testVoiceOnToOffCancelsAndResetsDedup() {
        let effects = effectsForVoiceToggle(wasEnabled: true)
        XCTAssertTrue(effects.cancelVoiceCountdown)
        XCTAssertTrue(effects.resetVoiceDedup)
        XCTAssertFalse(effects.preloadVoiceCountdown)
    }

    func testTogglingANonVoiceSoundLeavesVoiceEffectsUntouched() {
        // Enabling tick while voice is already on must not re-preload or cancel it.
        let whileVoiceOn = effectsForNonVoiceToggle(wasEnabled: false, voiceCountdown: true)
        XCTAssertTrue(whileVoiceOn.warmUp)
        XCTAssertFalse(whileVoiceOn.preloadVoiceCountdown)
        XCTAssertFalse(whileVoiceOn.cancelVoiceCountdown)
        XCTAssertFalse(whileVoiceOn.resetVoiceDedup)

        // Disabling tick while voice is off must be a no-op beyond the pref write.
        let whileVoiceOff = effectsForNonVoiceToggle(wasEnabled: true, voiceCountdown: false)
        XCTAssertEqual(
            whileVoiceOff,
            SoundToggleLogic.Effects(
                warmUp: false,
                preloadVoiceCountdown: false,
                cancelVoiceCountdown: false,
                resetVoiceDedup: false
            )
        )
    }

    // MARK: - Rapid toggling

    func testRapidOffOnOffOnSequenceWarmsOnlyOnEnables() {
        // Simulates four fast taps on the same control starting from off.
        var enabled = false
        var warmUps = 0
        for _ in 0..<4 {
            let effects = effectsForNonVoiceToggle(wasEnabled: enabled)
            if effects.warmUp { warmUps += 1 }
            enabled.toggle()
        }
        // off→on, on→off, off→on, on→off ⇒ exactly two warm-ups.
        XCTAssertEqual(warmUps, 2)
    }

    // MARK: - #712 haptics is not an audio channel

    /// Turning haptics on must not activate the audio session. The pill exists
    /// for someone who wants silence, and an AVAudioSession activation is not a
    /// harmless no-op on iOS — it can duck or interrupt whatever else the phone
    /// is playing. Enabling vibration should never touch their music.
    func testEnablingHapticsDoesNotWarmTheAudioSession() {
        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: false,
            toggledKeyIsEnabled: true,
            voiceCountdownWasEnabled: false,
            voiceCountdownIsEnabled: false,
            toggledKeyUsesAudio: false
        )

        XCTAssertFalse(effects.warmUp, "haptics needs no audio session")
        XCTAssertFalse(effects.preloadVoiceCountdown)
        XCTAssertFalse(effects.cancelVoiceCountdown)
        XCTAssertFalse(effects.resetVoiceDedup)
    }

    /// The guard above must be specific to the non-audio toggle — the same
    /// off→on transition on a real sound still has to warm up (#667).
    func testTheAudioDefaultStillWarmsUpOnEnable() {
        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: false,
            toggledKeyIsEnabled: true,
            voiceCountdownWasEnabled: false,
            voiceCountdownIsEnabled: false
        )

        XCTAssertTrue(effects.warmUp, "audio toggles keep the #667 warm-up")
    }

    func testDisablingHapticsStaysAPurePreferenceWrite() {
        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: true,
            toggledKeyIsEnabled: false,
            voiceCountdownWasEnabled: false,
            voiceCountdownIsEnabled: false,
            toggledKeyUsesAudio: false
        )

        XCTAssertFalse(effects.warmUp)
    }
}
